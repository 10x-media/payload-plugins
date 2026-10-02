import {
	type FlattenedBlock,
	type FlattenedField,
	getFieldByPath,
	type PayloadRequest,
	type Validate,
} from 'payload'

import type { CollectionContext } from '../plugin/context'
import type { MergeFieldSpec, MergePlan } from '../schema/types'
import {
	isEmpty,
	listOf,
	normalize,
	perLocale,
	readPath,
	rowFields,
	withHiddenRows,
	writePath,
} from './compare'

/**
 * What the absorbed document gives up so the survivor can hold the unique values it takes
 * over. Keys are decision keys: `path`, or `path@locale` for a localized field.
 */
export type UniqueRelease = {
	/** Swapped for a placeholder on the absorbed document. */
	marked: string[]
	/** Emptied on the absorbed document, where the database takes any number of empty values. */
	emptied: string[]
	/** Fit neither, so the absorbed document is deleted before the survivor takes them. */
	deletes: string[]
}

type Doc = Record<string, unknown> & { id: number | string }

/** A unique field, or a unique index over several; a localized field takes part in one locale. */
type Constraint = { members: { path: string; locale?: string }[]; index: boolean }

type Slot = {
	key: string
	path: string
	locale?: string
	field: FlattenedField
	spec: Pick<MergeFieldSpec, 'list' | 'type'>
	/** The survivor's value here changes with the merge. */
	moved: boolean
}

type ReleaseArgs = {
	req: PayloadRequest
	col: CollectionContext
	locales: string[] | null
	survivor: Doc
	absorbed: Doc
	plan: MergePlan
	/** The group's rows by id, read with the fields hidden from the API. */
	hidden: ReadonlyMap<string, Record<string, unknown>>
}

const PLACEHOLDER_TYPES = new Set(['code', 'email', 'text', 'textarea'])

const valueAt = (doc: Record<string, unknown>, path: string, locale?: string): unknown => {
	const value = readPath(doc, path)
	if (!locale || value === null || typeof value !== 'object' || Array.isArray(value)) return value
	return (value as Record<string, unknown>)[locale]
}

const members = (value: unknown, spec: Slot['spec']): Set<string> =>
	new Set(listOf(value).map((item) => normalize(item, { list: false, type: spec.type })))

/**
 * The unique rules as the database enforces them. A unique index over localized fields is one
 * index across every locale on MongoDB, and one per locale in SQL, which accepts it only when
 * all its fields are localized. A field inside a localized group is left out: `rowsTaken`
 * answers for it.
 */
const constraintsOf = (
	col: CollectionContext,
	locales: string[] | null,
	sql: boolean
): Constraint[] => {
	const out: Constraint[] = []
	for (const spec of col.spec) {
		if (!spec.unique) continue
		if (spec.localized && locales) {
			for (const locale of locales)
				out.push({ members: [{ path: spec.path, locale }], index: false })
		} else {
			out.push({ members: [{ path: spec.path }], index: false })
		}
	}
	for (const index of col.config.sanitizedIndexes ?? []) {
		if (!index.unique) continue
		const { fields } = index
		if (!locales || !fields.some((entry) => entry.pathHasLocalized)) {
			out.push({ members: fields.map((entry) => ({ path: entry.path })), index: true })
			continue
		}
		if (
			fields.some(
				(entry) => entry.pathHasLocalized && entry.localizedPath !== `${entry.path}.<locale>`
			)
		) {
			continue
		}
		if (sql) {
			for (const locale of locales) {
				out.push({ members: fields.map((entry) => ({ path: entry.path, locale })), index: true })
			}
			continue
		}
		out.push({
			members: fields.flatMap((entry) =>
				entry.pathHasLocalized
					? locales.map((locale) => ({ path: entry.path, locale }))
					: [{ path: entry.path }]
			),
			index: true,
		})
	}
	return out
}

/**
 * The values the absorbed document can keep in place of the one the survivor takes, the one
 * to try first first: the mark with the value it held, so the trashed document still reads
 * as what it was, then the bare mark. An email keeps its address under a domain no mail
 * reaches. A list gets the bare mark beside the items it keeps.
 */
const placeholdersFor = (
	field: FlattenedField,
	absorbedId: number | string,
	held: unknown
): unknown[] => {
	if (!PLACEHOLDER_TYPES.has(field.type)) return []
	const mark = `merged-${absorbedId}`
	const bare = field.type === 'email' ? `${mark}@dedupe.invalid` : mark
	if ('hasMany' in field && field.hasMany) return [[bare]]
	if (typeof held !== 'string' || held.trim() === '') return [bare]
	if (field.type !== 'email') return [`${mark} ${held}`, bare]
	return /^[^@\s]+@[^@\s]+$/.test(held) ? [`${mark}.${held}.invalid`, bare] : [bare]
}

/**
 * Writes one slot's value into an update of the absorbed document. A localized one keeps what
 * `data` already holds in the other locales; what the document holds there is laid under the
 * update when it is written.
 */
const put = (data: Record<string, unknown>, slot: Slot, value: unknown): void => {
	if (!slot.locale) {
		writePath(data, slot.path, value)
		return
	}
	const locales = (readPath(data, slot.path) ?? {}) as Record<string, unknown>
	writePath(data, slot.path, { ...locales, [slot.locale]: value })
}

/**
 * Whether the field's own validation takes the placeholder. Payload trashes without
 * validating, but a restore validates, so a placeholder it refuses would keep the
 * document in the trash for good.
 */
const validates = async (args: ReleaseArgs, slot: Slot, value: unknown): Promise<boolean> => {
	const { req, col, absorbed } = args
	const validate =
		'validate' in slot.field ? (slot.field.validate as Validate | undefined) : undefined
	if (!validate) return true
	const data = structuredClone(absorbed)
	put(data, slot, value)
	const parent = slot.path.includes('.')
		? readPath(data, slot.path.slice(0, slot.path.lastIndexOf('.')))
		: data
	try {
		const result = await validate(value, {
			...slot.field,
			id: absorbed.id,
			collectionSlug: col.slug,
			data,
			event: 'submit',
			operation: 'update',
			overrideAccess: true,
			path: slot.path.split('.'),
			preferences: { fields: {} },
			previousValue: valueAt(absorbed, slot.path, slot.locale),
			req,
			siblingData: parent,
		} as never)
		return result === true
	} catch {
		return false
	}
}

const collides = (args: ReleaseArgs, constraint: Constraint, slots: Slot[]): boolean => {
	if (!slots.some((slot) => slot.moved)) return false
	const final = (slot: Slot) => {
		const decision = args.plan.decisions.find((entry) => entry.key === slot.key)
		return decision ? decision.proposed : valueAt(args.survivor, slot.path, slot.locale)
	}
	// An SQL index lets a row with an empty member repeat; MongoDB indexes the gap as null.
	const sql = args.req.payload.db.name !== 'mongoose'
	return slots.every((slot) => {
		const theirs = valueAt(args.absorbed, slot.path, slot.locale)
		if (constraint.index) {
			// '' is a value to SQL; only a null member lets the row repeat.
			if (sql && (theirs === null || theirs === undefined)) return false
			return normalize(final(slot), slot.spec) === normalize(theirs, slot.spec)
		}
		if (isEmpty(theirs)) return false
		// A list field holds each of its values in one document only.
		const ours = members(final(slot), slot.spec)
		return [...members(theirs, slot.spec)].some((member) => ours.has(member))
	})
}

/** `insideLocale`: the data is one locale's value, so nothing in it holds a value per locale. */
type RowWalk = { blocks: FlattenedBlock[]; path: string; out: Set<string>; insideLocale?: boolean }

/** Collects every value a unique field holds in these fields, through nested rows and groups. */
const collectFields = (
	fields: FlattenedField[],
	data: Record<string, unknown>,
	walk: RowWalk
): void => {
	for (const field of fields) {
		const value = data[field.name]
		const next = { ...walk, path: `${walk.path}.${field.name}` }
		const localized = perLocale(field, Boolean(walk.insideLocale))
		const container = ['array', 'blocks', 'group', 'tab'].includes(field.type)
		if (localized && container && value !== null && typeof value === 'object') {
			// A list or group with a value per locale: each locale's value on its own.
			for (const one of Object.values(value as Record<string, unknown>)) {
				collectFields([field], { [field.name]: one }, { ...walk, insideLocale: true })
			}
		} else if (field.type === 'array' || field.type === 'blocks') {
			for (const row of Array.isArray(value) ? value : []) {
				if (row === null || typeof row !== 'object') continue
				const rowData = row as Record<string, unknown>
				collectFields(rowFields(field, rowData, walk.blocks), rowData, next)
			}
		} else if (field.type === 'group' || field.type === 'tab') {
			if (value !== null && typeof value === 'object') {
				collectFields(field.flattenedFields, value as Record<string, unknown>, next)
			}
		} else if ('unique' in field && field.unique && !isEmpty(value)) {
			const spec = { list: false, type: field.type }
			// A localized value is indexed per locale.
			const byLocale =
				localized && typeof value === 'object' && !Array.isArray(value)
					? Object.entries(value as Record<string, unknown>)
					: [['', value] as const]
			for (const [locale, entry] of byLocale) {
				for (const item of Array.isArray(entry) ? entry : [entry]) {
					if (!isEmpty(item)) walk.out.add(`${next.path}|${locale}|${normalize(item, spec)}`)
				}
			}
		}
	}
}

/**
 * Array and blocks fields, and localized groups, the survivor takes from an absorbed document,
 * where what it takes brings over a value a unique field inside holds. Neither a row nor a
 * field in a localized group has a placeholder of its own, so each of these makes the merge
 * delete the absorbed document.
 */
const rowsTaken = (args: ReleaseArgs): string[] => {
	const { req, col, locales, absorbed, plan, hidden } = args
	const blocks = req.payload.config.blocks ?? []
	const keys: string[] = []
	for (const spec of col.spec) {
		if (spec.type !== 'array' && spec.type !== 'blocks' && spec.type !== 'group') continue
		const found = getFieldByPath({ fields: col.config.flattenedFields, path: spec.path })
		if (!found) continue
		for (const locale of spec.localized && locales ? locales : [undefined]) {
			const key = locale ? `${spec.path}@${locale}` : spec.path
			const decision = plan.decisions.find((entry) => entry.key === key)
			if (!decision) continue
			const ours = new Set<string>()
			const theirs = new Set<string>()
			const root = [found.field]
			const full = (value: unknown) =>
				withHiddenRows(value, found.field, { known: blocks, insideLocale: spec.localized, hidden })
			collectFields(
				root,
				{ [found.field.name]: full(decision.proposed) },
				{ blocks, path: '', out: ours, insideLocale: spec.localized }
			)
			collectFields(
				root,
				{ [found.field.name]: full(valueAt(absorbed, spec.path, locale)) },
				{ blocks, path: '', out: theirs, insideLocale: spec.localized }
			)
			if ([...theirs].some((value) => ours.has(value))) keys.push(key)
		}
	}
	return keys
}

/**
 * How the absorbed document lets go of the unique values the survivor takes over, and the
 * update that does it. A text-like value is swapped for a placeholder built from the
 * absorbed document's id; any other value is emptied where the database allows repeated
 * empty values (not MongoDB, not a required field); a value that fits neither, or rows that
 * bring a unique value over, make the merge delete the absorbed document instead of
 * trashing it.
 */
export const releaseUnique = async (
	args: ReleaseArgs
): Promise<{ release: UniqueRelease; update: Record<string, unknown> | null }> => {
	const { req, col, survivor, absorbed, locales } = args
	const emptiesRepeat = req.payload.db.name !== 'mongoose'
	const release: UniqueRelease = { marked: [], emptied: [], deletes: [] }
	const update: Record<string, unknown> = {}
	// A list keeps the items the survivor does not take, beside the placeholder.
	const keptItems = (slot: Slot): unknown[] => {
		const single = { list: false, type: slot.spec.type }
		const proposed = args.plan.decisions.find((entry) => entry.key === slot.key)?.proposed
		const taken = new Set(listOf(proposed).map((item) => normalize(item, single)))
		return listOf(valueAt(absorbed, slot.path, slot.locale)).filter(
			(item) => !taken.has(normalize(item, single))
		)
	}
	const released = new Set<string>()

	for (const constraint of constraintsOf(col, locales, emptiesRepeat)) {
		const slots: Slot[] = []
		for (const { path, locale } of constraint.members) {
			const found = getFieldByPath({ fields: col.config.flattenedFields, path })
			if (!found) break
			const { field } = found
			const spec = col.specByPath.get(path) ?? {
				list: 'hasMany' in field && field.hasMany === true,
				type: field.type === 'tab' ? 'group' : field.type,
			}
			const key = locale ? `${path}@${locale}` : path
			const decision = args.plan.decisions.find((entry) => entry.key === key)
			const current = valueAt(survivor, path, locale)
			const moved =
				decision !== undefined && normalize(decision.proposed, spec) !== normalize(current, spec)
			slots.push({ key, path, locale, field, spec, moved })
		}
		if (slots.length !== constraint.members.length) continue
		if (slots.some((slot) => released.has(slot.key))) continue
		if (!collides(args, constraint, slots)) continue

		const ordered = [...slots.filter((slot) => slot.moved), ...slots.filter((slot) => !slot.moved)]
		let done = false
		for (const slot of ordered) {
			const held = valueAt(absorbed, slot.path, slot.locale)
			for (const mark of placeholdersFor(slot.field, absorbed.id, held)) {
				const placeholder = Array.isArray(mark) ? [...keptItems(slot), ...mark] : mark
				if (col.options.absorbed === 'trash' && !(await validates(args, slot, placeholder)))
					continue
				put(update, slot, placeholder)
				release.marked.push(slot.key)
				released.add(slot.key)
				done = true
				break
			}
			if (done) break
		}
		if (done) continue
		const emptiable = emptiesRepeat
			? ordered.find((slot) => !('required' in slot.field && slot.field.required))
			: undefined
		if (emptiable) {
			put(update, emptiable, null)
			release.emptied.push(emptiable.key)
			released.add(emptiable.key)
			continue
		}
		for (const slot of slots) if (slot.moved) release.deletes.push(slot.key)
	}
	release.deletes.push(...rowsTaken(args))

	if (release.deletes.length > 0) {
		return { release: { ...release, marked: [], emptied: [] }, update: null }
	}
	return { release, update: Object.keys(update).length > 0 ? update : null }
}
