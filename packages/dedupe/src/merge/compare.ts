import type { FlattenedBlock, FlattenedBlocksField, FlattenedField } from 'payload'
import type { MergeFieldSpec } from '../schema/types'

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

/** The blocks a blocks field allows: its own, and those it names from the config's `blocks`. */
export const blocksOf = (
	field: FlattenedBlocksField,
	known: readonly FlattenedBlock[] | undefined
): FlattenedBlock[] =>
	[...field.blocks, ...(field.blockReferences ?? [])].flatMap((entry) => {
		const block = typeof entry === 'string' ? known?.find((one) => one.slug === entry) : entry
		return block ? [block] : []
	})

/**
 * A rich text the editor emptied: Lexical keeps a root with no node, or with one paragraph and
 * no text in it. The rule `hasText` of `@payloadcms/richtext-lexical` applies, an optional peer.
 */
const isEmptyRichText = (value: unknown): boolean => {
	const root = isPlainObject(value) ? value.root : undefined
	if (!isPlainObject(root) || root.type !== 'root' || !Array.isArray(root.children)) return false
	const [only, ...more] = root.children as Record<string, unknown>[]
	if (!only) return true
	if (more.length > 0 || only.type !== 'paragraph') return false
	const inside = Array.isArray(only.children) ? (only.children as Record<string, unknown>[]) : []
	if (inside.length === 0) return true
	return inside.length === 1 && inside[0]?.type === 'text' && !inside[0]?.text
}

export const isEmpty = (value: unknown): boolean =>
	value === undefined ||
	value === null ||
	value === '' ||
	(Array.isArray(value) && value.length === 0) ||
	isEmptyRichText(value)

/** A value as a list: a list as it is, one value as a list of it, nothing as an empty list. */
export const listOf = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : isEmpty(value) ? [] : [value]

/** A group with nothing in it, down through the groups it holds. */
export const isEmptyGroup = (value: unknown): boolean =>
	value !== null &&
	typeof value === 'object' &&
	!Array.isArray(value) &&
	Object.values(value).every((inner) => isEmpty(inner) || isEmptyGroup(inner))

/** The id a relationship value points at; a polymorphic one keeps its collection in front. */
export const relationId = (value: unknown): string => {
	if (value !== null && typeof value === 'object') {
		const record = value as { id?: unknown; relationTo?: unknown; value?: unknown }
		if ('relationTo' in record) {
			return `${String(record.relationTo)}:${relationId(record.value)}`
		}
		if ('id' in record) return String(record.id)
	}
	return String(value)
}

/**
 * A row value without the ids Payload generates for rows: an `id` is dropped only from an
 * object that is an item of a list, where rows live, so an `id` that is data in a JSON or
 * group value still counts.
 */
const stripRowIds = (value: unknown, inList = false): unknown => {
	if (Array.isArray(value)) return value.map((item) => stripRowIds(item, true))
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {}
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (inList && key === 'id') continue
			out[key] = stripRowIds(entry)
		}
		return out
	}
	return value
}

const stable = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
	if (value !== null && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
	}
	return JSON.stringify(value) ?? 'undefined'
}

/**
 * One comparable string per value, by field type: relationships by id whichever shape
 * they arrive in, dates by instant, text trimmed, lists as sets of their normalized
 * members, rows without their generated ids.
 */
export const normalize = (value: unknown, spec: Pick<MergeFieldSpec, 'list' | 'type'>): string => {
	if (isEmpty(value)) return ''
	if (spec.list) {
		const items = (Array.isArray(value) ? value : [value]).map((item) =>
			normalize(item, { list: false, type: spec.type })
		)
		if (spec.type === 'array' || spec.type === 'blocks') return items.join('\n')
		return [...new Set(items)].sort().join('\n')
	}
	switch (spec.type) {
		case 'relationship':
		case 'upload':
			return relationId(value)
		case 'date': {
			const time = new Date(value as string).getTime()
			return Number.isNaN(time) ? String(value) : String(time)
		}
		case 'text':
		case 'textarea':
		case 'email':
		case 'code':
			return String(value).trim()
		case 'number':
			return String(Number(value))
		case 'array':
		case 'blocks':
			return stable(stripRowIds(value, true))
		case 'group':
			return stable(stripRowIds(value))
		default:
			return stable(value)
	}
}

export const sameValue = (
	a: unknown,
	b: unknown,
	spec: Pick<MergeFieldSpec, 'list' | 'type'>
): boolean => normalize(a, spec) === normalize(b, spec)

/** The fields one row, group or block of `field` holds. */
export const rowFields = (
	field: FlattenedField,
	row: Record<string, unknown>,
	known: readonly FlattenedBlock[] | undefined
): FlattenedField[] =>
	field.type === 'array' || field.type === 'group' || field.type === 'tab'
		? field.flattenedFields
		: field.type === 'blocks'
			? (blocksOf(field, known).find((block) => block.slug === row.blockType)?.flattenedFields ??
				[])
			: []

/** Every field a row, group or block of `field` holds, however deep. */
export const fieldsWithin = (
	field: FlattenedField,
	known: readonly FlattenedBlock[] | undefined
): FlattenedField[] => {
	const own =
		field.type === 'array' || field.type === 'group' || field.type === 'tab'
			? field.flattenedFields
			: field.type === 'blocks'
				? blocksOf(field, known).flatMap((block) => block.flattenedFields)
				: []
	return own.flatMap((sub) => [sub, ...fieldsWithin(sub, known)])
}

/**
 * Whether `field` holds a value per locale in a document read in every locale: it is
 * localized, and nothing it sits in is.
 */
export const perLocale = (field: FlattenedField, insideLocale: boolean): boolean =>
	!insideLocale && 'localized' in field && field.localized === true

/** A new row id, in the form Payload gives one. */
const newRowId = (): string =>
	Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('')

type Fresh = { known: readonly FlattenedBlock[] | undefined; insideLocale: boolean }

/** A row, group or block with a new id on every row inside it, per locale where it is one. */
const withFreshIds = (
	value: Record<string, unknown>,
	fields: FlattenedField[],
	context: Fresh
): Record<string, unknown> => {
	const out = { ...value }
	for (const field of fields) {
		if (!(field.name in out)) continue
		const inner = out[field.name]
		out[field.name] =
			perLocale(field, context.insideLocale) && isPlainObject(inner)
				? Object.fromEntries(
						Object.entries(inner).map(([code, one]) => [
							code,
							freshNested(one, field, { ...context, insideLocale: true }),
						])
					)
				: freshNested(inner, field, context)
	}
	return out
}

const freshNested = (value: unknown, field: FlattenedField, context: Fresh): unknown => {
	if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
		return value.map((row) => freshRow(row, field, context))
	}
	if ((field.type === 'group' || field.type === 'tab') && isPlainObject(value)) {
		return withFreshIds(value, field.flattenedFields, context)
	}
	return value
}

const freshRow = (row: unknown, field: FlattenedField, context: Fresh): unknown =>
	isPlainObject(row)
		? { ...withFreshIds(row, rowFields(field, row, context.known), context), id: newRowId() }
		: row

/**
 * `value` of `field` with the fields hidden from the API put back into every row, and every
 * group or tab inside one, from `hidden`: the rows of the group's documents by id, read with
 * them. Payload keeps a hidden value only on a row whose id it already holds.
 */
export const withHiddenRows = (
	value: unknown,
	field: FlattenedField,
	context: {
		known: readonly FlattenedBlock[] | undefined
		insideLocale: boolean
		hidden: ReadonlyMap<string, Record<string, unknown>>
	}
): unknown => {
	/** `from` is the same value as read with the hidden fields, where there is one. */
	type At = { from: unknown; insideLocale: boolean }
	const fill = (row: Record<string, unknown>, fields: FlattenedField[], at: At) => {
		const full = isPlainObject(at.from) ? at.from : undefined
		const out = { ...row }
		for (const sub of fields) {
			if (sub.hidden === true) {
				if (full && sub.name in full && !(sub.name in out)) out[sub.name] = full[sub.name]
				continue
			}
			if (!(sub.name in out)) continue
			const inner = out[sub.name]
			const from = full?.[sub.name]
			out[sub.name] =
				perLocale(sub, at.insideLocale) && isPlainObject(inner)
					? Object.fromEntries(
							Object.entries(inner).map(([code, one]) => [
								code,
								within(one, sub, {
									from: isPlainObject(from) ? from[code] : undefined,
									insideLocale: true,
								}),
							])
						)
					: within(inner, sub, { from, insideLocale: at.insideLocale })
		}
		return out
	}
	const within = (inner: unknown, sub: FlattenedField, at: At): unknown => {
		if ((sub.type === 'array' || sub.type === 'blocks') && Array.isArray(inner)) {
			return inner.map((row) =>
				isPlainObject(row)
					? fill(row, rowFields(sub, row, context.known), {
							from:
								row.id === undefined || row.id === null
									? undefined
									: context.hidden.get(String(row.id)),
							insideLocale: at.insideLocale,
						})
					: row
			)
		}
		if ((sub.type === 'group' || sub.type === 'tab') && isPlainObject(inner)) {
			return fill(inner, sub.flattenedFields, at)
		}
		return inner
	}
	return within(value, field, { from: undefined, insideLocale: context.insideLocale })
}

/**
 * Every row the documents hold, however deep, by its id. An id two rows share, as a copy made
 * with its row ids has, names neither: a hidden value from the wrong row is worse than none.
 */
export const rowsById = (docs: Record<string, unknown>[]): Map<string, Record<string, unknown>> => {
	const out = new Map<string, Record<string, unknown>>()
	const shared = new Set<string>()
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isPlainObject(item) && (typeof item.id === 'string' || typeof item.id === 'number')) {
					const id = String(item.id)
					if (out.has(id)) shared.add(id)
					out.set(id, item)
				}
				walk(item)
			}
		} else if (isPlainObject(value)) {
			for (const inner of Object.values(value)) walk(inner)
		}
	}
	for (const doc of docs) for (const value of Object.values(doc)) walk(value)
	for (const id of shared) out.delete(id)
	return out
}

/**
 * `value` of `field` as the survivor writes it: rows taken from another document get new ids,
 * every row inside them too, through a group or tab down to the lists it holds. On Postgres a
 * row id, a nested one too, is the primary key of its table, and the document the rows come
 * from still holds them while the survivor is written. The ids are given here rather than by
 * Payload, so that each locale's write of the same rows names them alike. The survivor's own
 * rows, told by `own` (its value of the same field), keep theirs, each once: a copy holding
 * the same id gets a new one. `insideLocale` says that `value` is one locale's value.
 */
export const freshWithin = (
	value: unknown,
	field: FlattenedField,
	context: Fresh & { own: unknown }
): unknown => {
	const { own } = context
	if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
		const ids = new Set(
			Array.isArray(own) ? own.map((row) => String((row as { id?: unknown })?.id)) : []
		)
		const kept = new Set<string>()
		return value.map((row) => {
			const id = (row as { id?: unknown } | null)?.id
			const key = id === undefined || id === null ? null : String(id)
			if (key === null || !ids.has(key) || kept.has(key)) return freshRow(row, field, context)
			kept.add(key)
			return row
		})
	}
	if ((field.type !== 'group' && field.type !== 'tab') || !isPlainObject(value)) return value
	const mine = isPlainObject(own) ? own : {}
	const out = { ...value }
	for (const sub of field.flattenedFields) {
		if (sub.name in out) {
			out[sub.name] = freshWithin(out[sub.name], sub, { ...context, own: mine[sub.name] })
		}
	}
	return out
}

/**
 * Whether the rows, groups and blocks of `value`, read in every locale, hold a value in
 * `locale` in a field that has one per locale.
 */
export const heldIn = (
	value: unknown,
	field: FlattenedField,
	context: { locale: string; known: readonly FlattenedBlock[] | undefined }
): boolean =>
	partsWithin(field, value, context.known).some(({ fields, row }) =>
		fields.some((sub) => {
			const inner = row[sub.name]
			if (perLocale(sub, false)) {
				const one = isPlainObject(inner) ? inner[context.locale] : undefined
				return !isEmpty(one) && !isEmptyGroup(one)
			}
			return heldIn(inner, sub, context)
		})
	)

/**
 * The path below `field` of the first value Payload requires and one locale's `value` leaves
 * empty in its rows, groups and blocks, or null. Outside a localized value only the fields
 * with a value per locale count: the rest is stored once and was valid when saved.
 */
export const requiredGap = (
	value: unknown,
	field: FlattenedField,
	context: { known: readonly FlattenedBlock[] | undefined; insideLocale: boolean }
): string | null => {
	for (const { fields, row } of partsWithin(field, value, context.known)) {
		for (const sub of fields) {
			const inner = row[sub.name]
			const local = context.insideLocale || perLocale(sub, false)
			if (local && 'required' in sub && sub.required && isEmpty(inner)) return sub.name
			const deeper = requiredGap(inner, sub, { ...context, insideLocale: local })
			if (deeper) return `${sub.name}.${deeper}`
		}
	}
	return null
}

/** The rows, groups and blocks `value` of `field` holds, each with its fields. */
export const partsWithin = (
	field: FlattenedField,
	value: unknown,
	known: readonly FlattenedBlock[] | undefined
): { fields: FlattenedField[]; row: Record<string, unknown> }[] => {
	if ((field.type === 'group' || field.type === 'tab') && isPlainObject(value)) {
		return [{ fields: field.flattenedFields, row: value }]
	}
	if ((field.type !== 'array' && field.type !== 'blocks') || !Array.isArray(value)) return []
	return value.filter(isPlainObject).map((row) => ({ fields: rowFields(field, row, known), row }))
}

/**
 * `value` of `field`, read in every locale, as one locale holds it: each value per locale in
 * its rows, groups and blocks narrowed to `locale`. What is not per locale stays as it is.
 */
export const inLocale = (
	value: unknown,
	field: FlattenedField,
	context: { locale: string; known: readonly FlattenedBlock[] | undefined }
): unknown => {
	const narrow = (row: Record<string, unknown>, fields: FlattenedField[]) => {
		const out = { ...row }
		for (const sub of fields) {
			if (!(sub.name in out)) continue
			const inner = out[sub.name]
			out[sub.name] = perLocale(sub, false)
				? isPlainObject(inner)
					? inner[context.locale]
					: inner
				: inLocale(inner, sub, context)
		}
		return out
	}
	if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
		return value.map((row) =>
			isPlainObject(row) ? narrow(row, rowFields(field, row, context.known)) : row
		)
	}
	if ((field.type === 'group' || field.type === 'tab') && isPlainObject(value)) {
		return narrow(value, field.flattenedFields)
	}
	return value
}

/**
 * Survivor items first, then the absorbed ones. Scalar members already present are skipped
 * by their normalized form. Rows are never compared, since two rows that differ only in a
 * detail are as likely the same entry as not: every row is kept with its id, which tells the
 * document it came from; the write gives rows from other documents fresh ones.
 */
export const unionValues = (
	survivor: unknown,
	absorbed: unknown,
	spec: Pick<MergeFieldSpec, 'list' | 'type'>
): unknown[] => {
	const left = Array.isArray(survivor) ? survivor : isEmpty(survivor) ? [] : [survivor]
	const right = Array.isArray(absorbed) ? absorbed : isEmpty(absorbed) ? [] : [absorbed]
	if (spec.type === 'array' || spec.type === 'blocks') return [...left, ...right]
	const single = { list: false, type: spec.type }
	const seen = new Set(left.map((item) => normalize(item, single)))
	const extra: unknown[] = []
	for (const item of right) {
		const key = normalize(item, single)
		if (seen.has(key)) continue
		seen.add(key)
		extra.push(item)
	}
	return [...left, ...extra]
}

export const readPath = (doc: Record<string, unknown>, path: string): unknown =>
	path.split('.').reduce<unknown>((value, key) => {
		if (value === null || typeof value !== 'object') return undefined
		return (value as Record<string, unknown>)[key]
	}, doc)

export const writePath = (doc: Record<string, unknown>, path: string, value: unknown): void => {
	const keys = path.split('.')
	let cursor = doc
	for (const key of keys.slice(0, -1)) {
		const next = cursor[key]
		if (next === null || typeof next !== 'object' || Array.isArray(next)) {
			cursor[key] = {}
		}
		cursor = cursor[key] as Record<string, unknown>
	}
	cursor[keys[keys.length - 1] as string] = value
}

/** Deep-merges nested containers so `base` and a locale's values share a group; lists replace. */
export const mergeData = (
	target: Record<string, unknown>,
	source: Record<string, unknown>
): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...target }
	for (const [key, value] of Object.entries(source)) {
		const existing = out[key]
		out[key] = isPlainObject(existing) && isPlainObject(value) ? mergeData(existing, value) : value
	}
	return out
}
