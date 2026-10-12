import type { FlattenedBlock, FlattenedField } from 'payload'

import type {
	DecisionSource,
	DocValue,
	MergeChoice,
	MergeDecision,
	MergeFieldSpec,
	MergePlan,
	ReviewedFieldSpec,
} from '../schema/types'
import {
	heldIn,
	inLocale,
	isEmpty,
	isEmptyGroup,
	isPlainObject,
	listOf,
	normalize,
	perLocale,
	readPath,
	relationId,
	requiredGap,
	rowFields,
	sameValue,
	unionValues,
	writePath,
} from './compare'

type Doc = Record<string, unknown> & { id: number | string }

type PlanArgs = {
	/** Every document read with `locale: 'all'` and `depth: 0`. */
	survivor: Doc
	absorbed: readonly Doc[]
	fields: readonly ReviewedFieldSpec[]
	/** Locale codes of the host, or `null` without localization. */
	locales: readonly string[] | null
	/** Reviewer answers keyed by decision key. */
	choices?: Readonly<Record<string, MergeChoice>>
	/** The collection merged, so a pointer at a document of the merge itself is told apart. */
	collection: string
	/**
	 * The collection's fields and the config's blocks, to find such pointers inside rows,
	 * groups and blocks. Without them only a field's own value is looked at.
	 */
	schema?: { fields: readonly FlattenedField[]; blocks?: readonly FlattenedBlock[] }
	/** The locale the values every locale shares are written in, the first write of the survivor. */
	writeLocale?: string | null
	/** Absorbed ids, the one most like the survivor first: where a required value comes from. */
	similar?: readonly string[]
	/** `false` where Payload does not validate the write, as when saving a draft. */
	validates?: boolean
	/**
	 * The collection publishes over drafts: a locale whose required values the survivor lacked
	 * before the merge is written as a draft and published with `writeLocale`, which Payload
	 * checks alone, as it publishes any draft.
	 */
	publishesDrafts?: boolean
}

type Resolution = { proposed: unknown; source: DecisionSource; auto: boolean }

const editedAt = (doc: Doc): number => {
	const time = Date.parse(String(doc.updatedAt ?? ''))
	return Number.isNaN(time) ? 0 : time
}

/**
 * The value a field takes without a choice: the survivor's, or, where the survivor has
 * none, that of the most recently edited document that has one.
 */
const resolve = (spec: MergeFieldSpec, values: DocValue[], newest: string[]): Resolution => {
	const [own] = values as [DocValue, ...DocValue[]]
	if (values.every(({ value }) => sameValue(value, own.value, spec))) {
		return { proposed: own.value, source: 'same', auto: false }
	}
	if (spec.policy === 'survivor') return { proposed: own.value, source: own.doc, auto: false }
	if (spec.policy === 'union' && spec.list) {
		const proposed = values.reduce<unknown[]>((acc, { value }) => unionValues(acc, value, spec), [])
		return { proposed, source: 'union', auto: false }
	}
	if (!isEmpty(own.value)) return { proposed: own.value, source: own.doc, auto: false }
	const donor = newest
		.map((id) => values.find((entry) => entry.doc === id) as DocValue)
		.find(({ value }) => !isEmpty(value)) as DocValue
	return { proposed: donor.value, source: donor.doc, auto: true }
}

const decide = (args: {
	spec: MergeFieldSpec
	key: string
	locale?: string
	values: DocValue[]
	newest: string[]
	choice: MergeChoice | undefined
}): MergeDecision => {
	const { spec, values, choice } = args
	const own = (values[0] as DocValue).value
	const resolution = resolve(spec, values, args.newest)
	const filled = values.filter(({ value }) => !isEmpty(value))
	const conflict =
		spec.policy !== 'survivor' &&
		!(spec.policy === 'union' && spec.list) &&
		filled.some(({ value }) => !sameValue(value, (filled[0] as DocValue).value, spec))

	return withChoice(
		{
			key: args.key,
			path: spec.path,
			...(args.locale ? { locale: args.locale } : {}),
			type: spec.type,
			policy: spec.policy,
			hidden: spec.hidden,
			list: spec.list,
			required: spec.required,
			...(spec.relationTo ? { relationTo: spec.relationTo } : {}),
			component: spec.component,
			values,
			...resolution,
			conflict,
			// A field the reviewer never sees cannot wait for their choice.
			requiresChoice: conflict && spec.policy === 'manual' && !spec.hidden,
			changed: !sameValue(resolution.proposed, own, spec),
		},
		choice
	)
}

type Choosable = Pick<MergeDecision, 'hidden' | 'list' | 'policy' | 'type'>

/** A field the reviewer picks for: one document, or several for a list. A survivor-only field is not. */
export const choosable = (decision: Choosable): boolean =>
	!decision.hidden && decision.policy !== 'survivor'

/**
 * The decision with the reviewer's answer applied. Pure and small enough for the merge
 * screen to call on every click, so a choice never needs the server to re-plan. The server
 * applies the same rules, so an answer the screen does not offer is ignored: a document
 * outside the group, a field the reviewer does not choose for, several documents for a field
 * that is not a list, anything but a document or a list's items. The plan then leaves out
 * pointers at the merge's own documents, which the screen names in `cleared`.
 */
export const withChoice = <T extends MergeDecision>(
	decision: T,
	choice: MergeChoice | undefined
): T => {
	if (!choice || !choosable(decision)) return decision
	if ('items' in choice) {
		if (!decision.list) return decision
		const place = new Map(decision.values.map((entry, index) => [entry.doc, index]))
		const itemsOf = (doc: string) =>
			listOf((decision.values[place.get(doc) as number] as DocValue).value)
		const picked = choice.items
			.filter(({ doc, index }) => place.has(doc) && index >= 0 && index < itemsOf(doc).length)
			.sort(
				(x, y) => (place.get(x.doc) as number) - (place.get(y.doc) as number) || x.index - y.index
			)
		if (decision.required && picked.length === 0) return decision
		const proposed = picked.reduce<unknown[]>(
			(acc, { doc, index }) => unionValues(acc, [itemsOf(doc)[index]], decision),
			[]
		)
		const [only, ...more] = [...new Set(picked.map(({ doc }) => doc))]
		return {
			...decision,
			proposed,
			source: only !== undefined && more.length === 0 ? only : 'union',
			auto: false,
			requiresChoice: false,
			changed: !sameValue(proposed, (decision.values[0] as DocValue).value, decision),
		}
	}
	if (!('doc' in choice)) return decision
	const picked = decision.values.find((entry) => entry.doc === choice.doc)
	if (!picked || (decision.required && isEmpty(picked.value))) return decision
	const proposed = picked.value
	return {
		...decision,
		proposed,
		source: picked.doc,
		auto: false,
		requiresChoice: false,
		changed: !sameValue(proposed, (decision.values[0] as DocValue).value, decision),
	}
}

/** The items of a list the result is made of: the checked ones, or by default the plan's own. */
export const pickedItems = (
	decision: MergeDecision,
	choice: MergeChoice | undefined,
	survivor: string
): { doc: string; index: number }[] => {
	const itemsOf = (doc: string) =>
		listOf(decision.values.find((entry) => entry.doc === doc)?.value).map((_, index) => ({
			doc,
			index,
		}))
	// Only what `withChoice` keeps: items of the group's documents, within their lists.
	const chosen =
		choice && 'items' in choice
			? choice.items.filter(({ doc, index }) => index >= 0 && index < itemsOf(doc).length)
			: choice && 'doc' in choice
				? itemsOf(choice.doc)
				: undefined
	// A required list a choice would leave empty keeps the plan's items, as `withChoice` does.
	if (chosen && !(decision.required && chosen.length === 0)) return chosen
	if (decision.source === 'union') return decision.values.flatMap(({ doc }) => itemsOf(doc))
	return itemsOf(decision.source === 'same' ? survivor : decision.source)
}

/**
 * Which items of each document's list went into the result: one the result holds as it is,
 * counted for the first document that has it. A row is told by its id, and counts only
 * while the result holds it unchanged.
 */
export const takenItems = (
	decision: Pick<MergeDecision, 'list' | 'proposed' | 'type' | 'values'>
): ((doc: string, item: unknown) => boolean) => {
	const rows = decision.list && (decision.type === 'array' || decision.type === 'blocks')
	const spec = { list: false, type: decision.type }
	const key = (item: unknown) => {
		const id = (item as { id?: unknown } | null)?.id
		return rows && typeof id === 'string' ? `id:${id}` : normalize(item, spec)
	}
	const kept = new Map(listOf(decision.proposed).map((item) => [key(item), item]))
	const holder = new Map<string, string>()
	for (const { doc, value } of decision.values) {
		for (const item of listOf(value)) if (!holder.has(key(item))) holder.set(key(item), doc)
	}
	return (doc, item) => {
		const result = kept.get(key(item))
		return (
			kept.has(key(item)) &&
			holder.get(key(item)) === doc &&
			normalize(result, spec) === normalize(item, spec)
		)
	}
}

const localeValue = (value: unknown, locale: string): unknown =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)[locale]
		: undefined

/** Where a merge looks for pointers at its own documents. */
type Home = {
	collection: string
	ids: ReadonlySet<string>
	blocks: readonly FlattenedBlock[] | undefined
}

/** The part of a field that says whether its value may point at the merge's own documents. */
type PointerField = Pick<MergeFieldSpec, 'relationTo' | 'required'> & { type: string }

/** The field at a spec's path: through groups and tabs, where array and blocks are leaves. */
const fieldAt = (fields: readonly FlattenedField[], path: string): FlattenedField | undefined => {
	const [head, ...rest] = path.split('.')
	const field = fields.find((entry) => entry.name === head)
	if (!field || rest.length === 0) return field
	return field.type === 'group' || field.type === 'tab'
		? fieldAt(field.flattenedFields, rest.join('.'))
		: undefined
}

/**
 * `value` of `field` without the pointers it holds at documents of the merge itself, down
 * through rows, groups and blocks: after the merge they would point at a document gone or
 * at the survivor itself. A field that may not be left empty keeps them.
 * `insideLocale` says that `value` is one locale's value.
 */
const withoutOwn = (
	value: unknown,
	field: FlattenedField | PointerField,
	context: { home: Home; insideLocale: boolean }
): unknown => {
	const { home } = context
	if (field.type === 'relationship' || field.type === 'upload') {
		const { relationTo } = field as PointerField
		const targets = Array.isArray(relationTo) ? relationTo : [relationTo]
		if (field.required || !targets.includes(home.collection)) return value
		const own = (item: unknown) =>
			Array.isArray(relationTo)
				? (item as { relationTo?: unknown } | null)?.relationTo === home.collection &&
					home.ids.has(relationId((item as { value?: unknown }).value))
				: home.ids.has(relationId(item))
		if (Array.isArray(value)) return value.filter((item) => !own(item))
		return !isEmpty(value) && own(value) ? null : value
	}
	// A spec stands in for a field the schema was not given for: its rows stay as they are.
	if (!('name' in field)) return value
	const fields = field
	const inside = (row: Record<string, unknown>) => {
		const out = { ...row }
		for (const sub of rowFields(fields, row, home.blocks)) {
			if (!(sub.name in out)) continue
			const inner = out[sub.name]
			out[sub.name] =
				perLocale(sub, context.insideLocale) && isPlainObject(inner)
					? Object.fromEntries(
							Object.entries(inner).map(([code, one]) => [
								code,
								withoutOwn(one, sub, { ...context, insideLocale: true }),
							])
						)
					: withoutOwn(inner, sub, context)
		}
		return out
	}
	if ((fields.type === 'array' || fields.type === 'blocks') && Array.isArray(value)) {
		return value.map((row) => (isPlainObject(row) ? inside(row) : row))
	}
	if ((fields.type === 'group' || fields.type === 'tab') && isPlainObject(value)) {
		return inside(value)
	}
	return value
}

/** The decision with its result `withoutOwn`, unless the reviewer may not change the field. */
const withoutOwnPointers = <T extends MergeDecision>(
	decision: T,
	spec: ReviewedFieldSpec,
	context: { home: Home; field: FlattenedField | undefined }
): T => {
	if (spec.locked || isEmpty(decision.proposed)) return decision
	const kept = withoutOwn(decision.proposed, context.field ?? spec, {
		home: context.home,
		insideLocale: Boolean(decision.locale),
	})
	if (sameValue(kept, decision.proposed, spec)) return decision
	const survivorValue = (decision.values[0] as DocValue).value
	return { ...decision, proposed: kept, changed: !sameValue(kept, survivorValue, spec) }
}

/**
 * What the merged survivor would look like, and what the reviewer has to answer.
 *
 * Pure: nothing is read or written. A localized field becomes one decision per locale
 * so a choice on one language never touches another; the result is split into the
 * non-localized `base` and one map per locale, because Payload updates one locale at a
 * time.
 */
export const planMerge = ({
	survivor,
	absorbed,
	fields,
	locales,
	choices = {},
	collection,
	schema,
	writeLocale,
	similar = [],
	validates = true,
	publishesDrafts = false,
}: PlanArgs): MergePlan => {
	const docs = [survivor, ...absorbed]
	const home: Home = {
		collection,
		ids: new Set(docs.map((doc) => String(doc.id))),
		blocks: schema?.blocks,
	}
	const cleared: string[] = []
	const clean = (decision: MergeDecision, spec: ReviewedFieldSpec): MergeDecision => {
		const field = schema ? fieldAt(schema.fields, spec.path) : undefined
		const next = withoutOwnPointers(decision, spec, { home, field })
		if (next !== decision && !spec.unread) cleared.push(decision.key)
		return next
	}
	const newest = [...docs].sort((x, y) => editedAt(y) - editedAt(x)).map((doc) => String(doc.id))
	const decisions: MergeDecision[] = []
	const base: Record<string, unknown> = {}
	const byLocale: Record<string, Record<string, unknown>> = {}

	for (const spec of fields) {
		if (spec.policy === 'skip') continue
		// Postgres reads back a group never filled in with every field empty; it counts as empty.
		const blank = (value: unknown) =>
			spec.type === 'group' && isEmptyGroup(value) ? undefined : value
		const raw = docs.map((doc) => ({ doc: String(doc.id), value: readPath(doc, spec.path) }))

		if (spec.localized && locales) {
			for (const locale of locales) {
				const key = `${spec.path}@${locale}`
				const decision = clean(
					decide({
						spec,
						key,
						locale,
						values: raw.map(({ doc, value }) => ({
							doc,
							value: blank(localeValue(value, locale)),
						})),
						newest,
						choice: choices[key],
					}),
					spec
				)
				decisions.push(decision)
				if (decision.changed) {
					byLocale[locale] ??= {}
					writePath(byLocale[locale], spec.path, decision.proposed ?? null)
				}
			}
			continue
		}

		const decision = clean(
			decide({
				spec,
				key: spec.path,
				values: raw.map(({ doc, value }) => ({ doc, value: blank(value) })),
				newest,
				choice: choices[spec.path],
			}),
			spec
		)
		decisions.push(decision)
		if (decision.changed) writePath(base, spec.path, decision.proposed ?? null)
	}

	const required =
		locales && schema && validates
			? requireInWritten({
					survivor,
					absorbed,
					fields,
					decisions,
					base,
					byLocale,
					locales,
					writeLocale,
					similar,
					schema,
					publishesDrafts,
				})
			: { missing: [], filled: [], drafted: [] }
	return {
		decisions,
		readyToApply:
			required.missing.length === 0 && decisions.every((decision) => !decision.requiresChoice),
		base,
		byLocale,
		cleared,
		...required,
	}
}

type Missing = MergePlan['missing'][number]

type Schema = { fields: readonly FlattenedField[]; blocks?: readonly FlattenedBlock[] }

type Placed = { path: string; field: FlattenedField }

/**
 * Where Payload checks values per locale: localized fields (`leaves`, a localized group or
 * list whole), and lists shared by every locale whose rows hold localized fields (`lists`).
 */
const perLocaleFields = (
	fields: readonly FlattenedField[]
): { lists: Placed[]; leaves: Placed[] } => {
	const lists: Placed[] = []
	const leaves: Placed[] = []
	const walk = (inner: readonly FlattenedField[], prefix: string) => {
		for (const field of inner) {
			if (!('name' in field) || field.type === 'join' || ('virtual' in field && field.virtual))
				continue
			const path = prefix ? `${prefix}.${field.name}` : field.name
			const container = ['array', 'blocks', 'group', 'tab'].includes(field.type)
			if ((field.type === 'group' || field.type === 'tab') && !field.localized) {
				walk(field.flattenedFields, path)
			} else if (field.localized) {
				leaves.push({ path, field })
			} else if (container) {
				lists.push({ path, field })
			}
		}
	}
	walk(fields, '')
	return { lists, leaves }
}

/** A value of `doc` at `path`, one locale's where a locale is named and the value has them. */
const readIn =
	(doc: Record<string, unknown>) =>
	(path: string, locale?: string): unknown => {
		const stored = readPath(doc, path)
		return locale && isPlainObject(stored) ? stored[locale] : stored
	}

/**
 * What Payload requires in `locale` that `valueAt` leaves empty: `value` for a required field
 * of its own, `none` for a list with too few rows, `rows` for a value inside rows or a
 * localized group, named by its path below the field.
 */
const gapsIn = (args: {
	locale: string
	schema: Schema
	valueAt: (path: string, locale?: string) => unknown
}): { path: string; kind: 'none' | 'rows' | 'value' }[] => {
	const { locale, schema, valueAt } = args
	const known = schema.blocks
	const { lists, leaves } = perLocaleFields(schema.fields)
	const gaps: { path: string; kind: 'none' | 'rows' | 'value' }[] = []
	for (const { path, field } of leaves) {
		const value = valueAt(path, locale)
		if (
			field.type === 'array' ||
			field.type === 'blocks' ||
			field.type === 'group' ||
			field.type === 'tab'
		) {
			const rows = listOf(value)
			const fewest = Math.max(
				'required' in field && field.required ? 1 : 0,
				'minRows' in field ? (field.minRows ?? 0) : 0
			)
			if (field.type !== 'group' && field.type !== 'tab' && rows.length < fewest) {
				gaps.push({ path, kind: 'none' })
				continue
			}
			const gap = requiredGap(value, field, { known, insideLocale: true })
			if (gap) gaps.push({ path: `${path}.${gap}`, kind: 'rows' })
			continue
		}
		if ('required' in field && field.required && isEmpty(value)) gaps.push({ path, kind: 'value' })
	}
	for (const { path, field } of lists) {
		const gap = requiredGap(inLocale(valueAt(path), field, { locale, known }), field, {
			known,
			insideLocale: false,
		})
		if (gap) gaps.push({ path: `${path}.${gap}`, kind: 'rows' })
	}
	return gaps
}

/** Whether `doc`, read in every locale, holds every value Payload requires in `locale`. */
export const completeIn = (doc: Record<string, unknown>, locale: string, schema: Schema): boolean =>
	gapsIn({ locale, schema, valueAt: readIn(doc) }).length === 0

/**
 * Payload checks every value a language requires when it writes that language, stored ones
 * too. A language is written where `writeLocale` is (the shared values change), where a value
 * of it changes, and where a list whose rows hold values per language carries values in it. A
 * required field the result leaves empty there takes the value of the most similar document
 * that has one, unless the reviewer may not take it; what stays empty is missing. A language
 * other than `writeLocale` whose every gap the survivor had before the merge is `drafted`
 * instead, where the collection publishes over drafts. `decisions` and `byLocale` take the
 * values filled in.
 */
const requireInWritten = (args: {
	survivor: Doc
	absorbed: readonly Doc[]
	fields: readonly ReviewedFieldSpec[]
	decisions: MergeDecision[]
	base: Record<string, unknown>
	byLocale: Record<string, Record<string, unknown>>
	locales: readonly string[]
	writeLocale: string | null | undefined
	similar: readonly string[]
	schema: Schema
	publishesDrafts: boolean
}): Pick<MergePlan, 'drafted' | 'filled' | 'missing'> => {
	const { survivor, absorbed, decisions, base, byLocale, locales, writeLocale, schema } = args
	const known = schema.blocks
	const specs = new Map(args.fields.map((spec) => [spec.path, spec]))
	const at = new Map(decisions.map((decision, index) => [decision.key, index]))
	const docs = [survivor, ...absorbed]
	const order = [...new Set([...args.similar, ...absorbed.map((doc) => String(doc.id))])]
	const before = readIn(survivor)
	// What the survivor holds at `path` once merged: the plan's result, else what it stores.
	const result = (path: string, locale?: string) => {
		const index = at.get(locale ? `${path}@${locale}` : path)
		const decided = index === undefined ? undefined : decisions[index]
		if (decided) return decided.proposed
		const stored = readPath(base, path) ?? readPath(survivor, path)
		return locale && isPlainObject(stored) ? stored[locale] : stored
	}

	const written = new Set(Object.keys(byLocale))
	if (writeLocale && Object.keys(base).length > 0) written.add(writeLocale)
	for (const { path, field } of perLocaleFields(schema.fields).lists) {
		const value = readPath(base, path)
		if (value === undefined) continue
		for (const locale of locales) {
			if (heldIn(value, field, { locale, known })) written.add(locale)
		}
	}

	const missing: Missing[] = []
	const filled: string[] = []
	const drafted: string[] = []
	for (const locale of written) {
		const open: Missing[] = []
		for (const gap of gapsIn({ locale, schema, valueAt: result })) {
			if (gap.kind !== 'value') {
				open.push({ path: gap.path, locale, reason: gap.kind })
				continue
			}
			const { path } = gap
			const key = `${path}@${locale}`
			const index = at.get(key)
			const spec = specs.get(path)
			const held = docs.some((doc) => !isEmpty(localeValue(readPath(doc, path), locale)))
			const takeable = index !== undefined && spec && !spec.locked && !spec.unread && !spec.sealed
			const decision = index === undefined ? undefined : decisions[index]
			const donor = takeable
				? order
						.map((id) => decision?.values.find((entry) => entry.doc === id))
						.find((entry) => entry !== undefined && !isEmpty(entry.value))
				: undefined
			if (!donor || !decision || index === undefined) {
				open.push({ path, locale, reason: held ? 'kept' : 'none' })
				continue
			}
			decisions[index] = {
				...decision,
				proposed: donor.value,
				source: donor.doc,
				auto: true,
				changed: true,
			}
			byLocale[locale] ??= {}
			writePath(byLocale[locale], path, donor.value)
			filled.push(key)
		}
		if (open.length === 0) continue
		const lackedBefore = new Set(gapsIn({ locale, schema, valueAt: before }).map((gap) => gap.path))
		if (
			args.publishesDrafts &&
			locale !== writeLocale &&
			open.every((gap) => lackedBefore.has(gap.path))
		) {
			drafted.push(locale)
		} else {
			missing.push(...open)
		}
	}
	return { missing, filled, drafted }
}
