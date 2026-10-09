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
 * all its fields are localized. A field inside a localized group is left out: `releaseRows`
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
const put = (
	data: Record<string, unknown>,
	slot: Pick<Slot, 'locale' | 'path'>,
	value: unknown
): void => {
	if (!slot.locale) {
		writePath(data, slot.path, value)
		return
	}
	const locales = (readPath(data, slot.path) ?? {}) as Record<string, unknown>
	writePath(data, slot.path, { ...locales, [slot.locale]: value })
}

/**
 * Whether the field's own validation takes the value. Payload trashes without validating, but
 * a restore validates, so a placeholder it refuses would keep the document in the trash for good.
 */
const accepts = async (
	args: ReleaseArgs,
	at: {
		field: FlattenedField
		value: unknown
		data: Record<string, unknown>
		siblingData: unknown
		path: string[]
		previousValue: unknown
	}
): Promise<boolean> => {
	const { req, col, absorbed } = args
	const { field, value } = at
	const validate = 'validate' in field ? (field.validate as Validate | undefined) : undefined
	if (!validate) return true
	try {
		const result = await validate(value, {
			...field,
			id: absorbed.id,
			collectionSlug: col.slug,
			data: at.data,
			event: 'submit',
			operation: 'update',
			overrideAccess: true,
			path: at.path,
			preferences: { fields: {} },
			previousValue: at.previousValue,
			req,
			siblingData: at.siblingData,
		} as never)
		return result === true
	} catch {
		return false
	}
}

const validates = (args: ReleaseArgs, slot: Slot, value: unknown): Promise<boolean> => {
	const data = structuredClone(args.absorbed)
	put(data, slot, value)
	const parent = slot.path.includes('.')
		? readPath(data, slot.path.slice(0, slot.path.lastIndexOf('.')))
		: data
	return accepts(args, {
		field: slot.field,
		value,
		data,
		siblingData: parent,
		path: slot.path.split('.'),
		previousValue: valueAt(args.absorbed, slot.path, slot.locale),
	})
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
type FieldWalk = { blocks: FlattenedBlock[]; path: string; insideLocale?: boolean }

/** One value a unique field holds, in one locale (`''` for none), and the data holding the field. */
type UniqueValue = {
	field: FlattenedField
	spec: Pick<MergeFieldSpec, 'list' | 'type'>
	path: string
	locale: string
	value: unknown
	siblingData: Record<string, unknown>
}

/**
 * These fields with each value a unique field holds passed through `leaf`, through nested rows
 * and groups, and lists or groups with a value per locale. `path` keys a value alike in every
 * document, so two walks can be compared.
 */
const mapUnique = async (
	{ fields, data }: { fields: FlattenedField[]; data: Record<string, unknown> },
	walk: FieldWalk,
	leaf: (unique: UniqueValue) => Promise<unknown>
): Promise<Record<string, unknown>> => {
	const out = { ...data }
	for (const field of fields) {
		const value = data[field.name]
		const next = { ...walk, path: `${walk.path}.${field.name}` }
		const localized = perLocale(field, Boolean(walk.insideLocale))
		const container = ['array', 'blocks', 'group', 'tab'].includes(field.type)
		if (localized && container && value !== null && typeof value === 'object') {
			// A list or group with a value per locale: each locale's value on its own.
			const byLocale: Record<string, unknown> = {}
			for (const [locale, one] of Object.entries(value as Record<string, unknown>)) {
				const inLocale = { ...walk, insideLocale: true }
				byLocale[locale] = (
					await mapUnique({ fields: [field], data: { [field.name]: one } }, inLocale, leaf)
				)[field.name]
			}
			out[field.name] = byLocale
		} else if (field.type === 'array' || field.type === 'blocks') {
			if (!Array.isArray(value)) continue
			const rows: unknown[] = []
			for (const row of value) {
				if (row === null || typeof row !== 'object') {
					rows.push(row)
					continue
				}
				const rowData = row as Record<string, unknown>
				rows.push(
					await mapUnique(
						{ fields: rowFields(field, rowData, walk.blocks), data: rowData },
						next,
						leaf
					)
				)
			}
			out[field.name] = rows
		} else if (field.type === 'group' || field.type === 'tab') {
			if (value !== null && typeof value === 'object') {
				out[field.name] = await mapUnique(
					{ fields: field.flattenedFields, data: value as Record<string, unknown> },
					next,
					leaf
				)
			}
		} else if ('unique' in field && field.unique && !isEmpty(value)) {
			// A localized value is indexed per locale.
			const at = (locale: string, one: unknown) =>
				leaf({
					field,
					spec: { list: false, type: field.type },
					path: next.path,
					locale,
					value: one,
					siblingData: data,
				})
			if (localized && typeof value === 'object' && !Array.isArray(value)) {
				const byLocale: Record<string, unknown> = {}
				for (const [locale, one] of Object.entries(value as Record<string, unknown>)) {
					byLocale[locale] = await at(locale, one)
				}
				out[field.name] = byLocale
			} else {
				out[field.name] = await at('', value)
			}
		}
	}
	return out
}

/** The key of one member of a unique value, alike in every document that holds it. */
const uniqueKey = ({ spec, path, locale }: UniqueValue, item: unknown): string =>
	`${path}|${locale}|${normalize(item, spec)}`

/** Every member of a unique value these fields hold, keyed by `uniqueKey`. */
const uniqueKeys = async (
	fields: FlattenedField[],
	data: Record<string, unknown>,
	walk: FieldWalk
): Promise<Set<string>> => {
	const keys = new Set<string>()
	await mapUnique({ fields, data }, walk, async (unique) => {
		for (const item of Array.isArray(unique.value) ? unique.value : [unique.value]) {
			if (!isEmpty(item)) keys.add(uniqueKey(unique, item))
		}
		return unique.value
	})
	return keys
}

/**
 * Array and blocks fields, and localized groups, the survivor takes from an absorbed document,
 * where what it takes brings over a value a unique field inside holds. The absorbed document
 * keeps its rows with each such value swapped, written into `update`; one that takes neither a
 * placeholder nor an empty value makes the merge delete the absorbed document.
 */
const releaseRows = async (
	args: ReleaseArgs,
	update: Record<string, unknown>,
	release: UniqueRelease
): Promise<void> => {
	const { req, col, locales, absorbed, plan, hidden } = args
	const blocks = req.payload.config.blocks ?? []
	for (const spec of col.spec) {
		if (spec.type !== 'array' && spec.type !== 'blocks' && spec.type !== 'group') continue
		const found = getFieldByPath({ fields: col.config.flattenedFields, path: spec.path })
		if (!found) continue
		for (const locale of spec.localized && locales ? locales : [undefined]) {
			const key = locale ? `${spec.path}@${locale}` : spec.path
			const decision = plan.decisions.find((entry) => entry.key === key)
			if (!decision) continue
			const root = [found.field]
			const full = (value: unknown) =>
				withHiddenRows(value, found.field, { known: blocks, insideLocale: spec.localized, hidden })
			const own = full(valueAt(absorbed, spec.path, locale))
			const walk = { blocks, path: '', insideLocale: spec.localized }
			const ours = await uniqueKeys(root, { [found.field.name]: full(decision.proposed) }, walk)
			const theirs = await uniqueKeys(root, { [found.field.name]: own }, walk)
			if (![...theirs].some((value) => ours.has(value))) continue
			const result = { marked: false, emptied: false, failed: false }
			// Each value the survivor takes swapped as a value at the top level is: for a
			// placeholder, or emptied where the database takes repeated empty values.
			const swapped = await mapUnique(
				{ fields: root, data: { [found.field.name]: own } },
				walk,
				async (unique) => {
					const { field, value: entry } = unique
					const taken = (item: unknown) => !isEmpty(item) && ours.has(uniqueKey(unique, item))
					const items = Array.isArray(entry) ? entry : [entry]
					if (!items.some(taken)) return entry
					for (const mark of placeholdersFor(field, absorbed.id, entry)) {
						const placeholder = Array.isArray(mark)
							? [...items.filter((item) => !taken(item)), ...mark]
							: mark
						if (
							col.options.absorbed === 'trash' &&
							!(await accepts(args, {
								field,
								value: placeholder,
								data: absorbed,
								siblingData: unique.siblingData,
								path: unique.path.slice(1).split('.'),
								previousValue: entry,
							}))
						) {
							continue
						}
						result.marked = true
						return placeholder
					}
					if (req.payload.db.name !== 'mongoose' && !('required' in field && field.required)) {
						result.emptied = true
						return null
					}
					result.failed = true
					return entry
				}
			)
			if (result.failed) {
				release.deletes.push(key)
				continue
			}
			put(update, { path: spec.path, locale }, swapped[found.field.name])
			;(result.marked ? release.marked : release.emptied).push(key)
		}
	}
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
	await releaseRows(args, update, release)

	if (release.deletes.length > 0) {
		return { release: { ...release, marked: [], emptied: [] }, update: null }
	}
	return { release, update: Object.keys(update).length > 0 ? update : null }
}
