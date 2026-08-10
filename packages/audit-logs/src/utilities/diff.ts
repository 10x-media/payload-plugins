import type { FieldKind, FieldMap } from './buildFieldMap'

// updatedAt is always excluded — it changes on every save and adds noise
// id is always excluded — it never changes for a document; appears as null in version snapshots
// when diffing against a fetched version (findVersions returns version data without the document id)
const ALWAYS_EXCLUDED_PATHS = new Set(['updatedAt', 'id'])

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
	val !== null && typeof val === 'object' && !Array.isArray(val)

const isObjectWithId = (val: unknown): val is Record<string, unknown> =>
	isPlainObject(val) && 'id' in val

/**
 * Polymorphic relationship: `{ relationTo: 'collectionSlug', value: id | populatedDoc }`.
 * Payload uses this shape when a relationship field has `relationTo` as an array of collections.
 */
const isPolymorphicRelationship = (val: unknown): val is { relationTo: string; value: unknown } =>
	isPlainObject(val) && typeof val.relationTo === 'string' && 'value' in val

/**
 * If the value is a populated Payload document (plain object with `id`), returns its `id`.
 * If the value is a polymorphic relationship object (`{ relationTo, value }`), returns a
 * normalized form `{ relationTo, value: id }` — collapsing any populated `value` to its id.
 * Otherwise returns the value as-is.
 * Used to normalize relationship fields before comparison.
 */
const extractId = (val: unknown): unknown => {
	if (isPolymorphicRelationship(val)) {
		return {
			relationTo: val.relationTo,
			value: isObjectWithId(val.value) ? val.value.id : val.value,
		}
	}
	return isObjectWithId(val) ? val.id : val
}

/**
 * Checks whether an array can be tracked by Payload's item ids.
 * Payload automatically adds an `id` field to every array item.
 * Empty arrays are considered id-trackable (vacuously true).
 */
const isIdTrackedArray = (arr: unknown[]): arr is Array<Record<string, unknown>> =>
	arr.every(isObjectWithId)

/**
 * Shallow equality check.
 * null and undefined are treated as equal — Payload may return either depending on the DB adapter.
 * Arrays and objects are compared by JSON serialization.
 */
const isEqual = (a: unknown, b: unknown): boolean => {
	if (a == null && b == null) return true
	if (a == null || b == null) return false
	if (typeof a !== typeof b) return false
	if (typeof a !== 'object') return a === b
	return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Looks up a path in the field map, supporting `*` wildcards for array item positions.
 * Tries exact match first, then falls back to wildcard matching.
 */
const getFieldKind = (path: string, fieldMap: FieldMap): FieldKind | undefined => {
	const exact = fieldMap.get(path)
	if (exact !== undefined) return exact
	const segments = path.split('.')
	for (const [key, kind] of fieldMap) {
		const keySegs = key.split('.')
		if (
			keySegs.length === segments.length &&
			keySegs.every((s, i) => s === '*' || s === segments[i])
		) {
			return kind
		}
	}
	return undefined
}

// Forward declaration — diffRecursive and diffArrayByIds call each other
let diffRecursive: (
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	excludeSet: Set<string>,
	prefix: string,
	result: Record<string, { after: unknown; before: unknown }>,
	fieldMap?: FieldMap
) => void

/**
 * Diffs two arrays of Payload array items (objects with `id` field).
 *
 * - Added items:   `path.{id}` → { before: null, after: item }
 * - Removed items: `path.{id}` → { before: item, after: null }
 * - Changed items: recurses into the item, producing `path.{id}.field` entries
 * - Reordered existing items: `path.__order__` → { before: [ids...], after: [ids...] }
 *   Only recorded when the relative order of items present in BOTH arrays changes.
 *   Pure add/remove operations do not trigger `__order__` since item-level diffs already capture them.
 *
 * Supports arbitrarily nested arrays — recursion handles array fields inside array items.
 */
const diffArrayByIds = (
	before: Array<Record<string, unknown>>,
	after: Array<Record<string, unknown>>,
	path: string,
	excludeSet: Set<string>,
	result: Record<string, { after: unknown; before: unknown }>,
	fieldMap?: FieldMap
): void => {
	const beforeMap = new Map(before.map((item) => [String(item.id), item]))
	const afterMap = new Map(after.map((item) => [String(item.id), item]))

	const beforeIds = before.map((item) => String(item.id))
	const afterIds = after.map((item) => String(item.id))

	// Detect reorder of items that exist in both arrays.
	// Pure add/remove does not trigger __order__ — item-level diffs already capture that.
	const sharedBeforeOrder = beforeIds.filter((id) => afterMap.has(id))
	const sharedAfterOrder = afterIds.filter((id) => beforeMap.has(id))
	if (!isEqual(sharedBeforeOrder, sharedAfterOrder)) {
		result[`${path}.__order__`] = { before: beforeIds, after: afterIds }
	}

	// Diff each item
	const allIds = new Set([...beforeIds, ...afterIds])
	for (const id of allIds) {
		const beforeItem = beforeMap.get(id)
		const afterItem = afterMap.get(id)
		const itemPath = `${path}.${id}`

		if (!beforeItem) {
			result[itemPath] = { before: null, after: afterItem! }
		} else if (!afterItem) {
			result[itemPath] = { before: beforeItem, after: null }
		} else {
			diffRecursive(beforeItem, afterItem, excludeSet, itemPath, result, fieldMap)
		}
	}
}

diffRecursive = (
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	excludeSet: Set<string>,
	prefix: string,
	result: Record<string, { after: unknown; before: unknown }>,
	fieldMap?: FieldMap
): void => {
	const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

	for (const key of allKeys) {
		const path = prefix ? `${prefix}.${key}` : key

		if (ALWAYS_EXCLUDED_PATHS.has(path) || excludeSet.has(path)) continue

		const beforeVal = before[key]
		const afterVal = after[key]

		if (isEqual(beforeVal, afterVal)) continue

		// Schema-aware: when a fieldMap is provided, use it to determine field kind.
		if (fieldMap) {
			const kind = getFieldKind(path, fieldMap)
			// join fields are virtual (not stored in DB) but can appear in hooks when selected.
			// Skip them entirely — they carry no meaningful audit information.
			if (kind === 'join') continue
			if (kind === 'rel-single') {
				const normBefore = extractId(beforeVal) ?? null
				const normAfter = extractId(afterVal) ?? null
				if (!isEqual(normBefore, normAfter)) {
					result[path] = { before: normBefore, after: normAfter }
				}
				continue
			}
			if (kind === 'rel-many') {
				const normBefore = Array.isArray(beforeVal) ? beforeVal.map(extractId) : (beforeVal ?? null)
				const normAfter = Array.isArray(afterVal) ? afterVal.map(extractId) : (afterVal ?? null)
				if (!isEqual(normBefore, normAfter)) {
					result[path] = { before: normBefore, after: normAfter }
				}
				continue
			}
		}

		// Heuristic fallback (no fieldMap, or field not in map):

		// Populated relationship: one side is a raw ID (string/number), the other is a populated
		// document object. Payload's afterChange hook may provide `doc` at request depth while
		// `previousDoc` is always at depth 0 — causing this asymmetry.
		// Normalize both sides to their IDs before comparing.
		const beforeIsScalar = typeof beforeVal === 'string' || typeof beforeVal === 'number'
		const afterIsScalar = typeof afterVal === 'string' || typeof afterVal === 'number'
		if (
			(beforeIsScalar && isObjectWithId(afterVal)) ||
			(afterIsScalar && isObjectWithId(beforeVal))
		) {
			const beforeId = extractId(beforeVal)
			const afterId = extractId(afterVal)
			if (beforeId === afterId) continue
			result[path] = { before: beforeId ?? null, after: afterId ?? null }
			continue
		}

		// Both sides are plain objects (not arrays) → recurse for granular paths
		if (isPlainObject(beforeVal) && isPlainObject(afterVal)) {
			diffRecursive(beforeVal, afterVal, excludeSet, path, result, fieldMap)
			continue
		}

		// Both sides are arrays → id-based diffing if possible, otherwise full before/after
		if (Array.isArray(beforeVal) && Array.isArray(afterVal)) {
			const beforeIsScalars =
				beforeVal.length > 0 &&
				beforeVal.every((v) => typeof v === 'string' || typeof v === 'number')
			const afterIsScalars =
				afterVal.length > 0 && afterVal.every((v) => typeof v === 'string' || typeof v === 'number')
			const beforeIsPopulated = isIdTrackedArray(beforeVal)
			const afterIsPopulated = isIdTrackedArray(afterVal)

			// Relationship array: one side raw IDs, other side populated objects — normalize to IDs
			if ((beforeIsScalars && afterIsPopulated) || (afterIsScalars && beforeIsPopulated)) {
				const normBefore = beforeVal.map(extractId)
				const normAfter = afterVal.map(extractId)
				if (!isEqual(normBefore, normAfter)) {
					result[path] = { before: normBefore, after: normAfter }
				}
				continue
			}

			if (beforeIsPopulated && afterIsPopulated) {
				diffArrayByIds(beforeVal, afterVal, path, excludeSet, result, fieldMap)
			} else {
				result[path] = { before: beforeVal, after: afterVal }
			}
			continue
		}

		// Everything else: primitives, null↔object/array transitions
		result[path] = {
			before: beforeVal ?? null,
			after: afterVal ?? null,
		}
	}
}

/**
 * Walks a fieldMap path into a snapshot object and normalizes the value at the leaf.
 * `*` segments mean "iterate every item in the array at this level".
 * Creates shallow copies of every object/array touched — original is never mutated.
 */
const applySnapshotNorm = (
	obj: Record<string, unknown>,
	segments: string[],
	kind: 'rel-single' | 'rel-many'
): void => {
	if (segments.length === 0) return
	const [head, ...rest] = segments
	if (head === undefined) return

	if (rest.length === 0) {
		// Leaf — normalize in place (obj is already a copy).
		// Skip if the field is absent — don't inject nulls for fields not present in this doc.
		if (!(head in obj)) return
		const val = obj[head]
		obj[head] =
			kind === 'rel-many'
				? Array.isArray(val)
					? val.map(extractId)
					: val
				: (extractId(val) ?? null)
		return
	}

	if (rest[0] === '*') {
		// Next segment is a wildcard → iterate array items
		const arr = obj[head]
		if (!Array.isArray(arr)) return
		obj[head] = arr.map((item) => {
			if (!isPlainObject(item)) return item
			const copy = { ...item } as Record<string, unknown>
			applySnapshotNorm(copy, rest.slice(1), kind) // rest.slice(1) skips the '*'
			return copy
		})
	} else {
		// Recurse into nested object
		const nested = obj[head]
		if (!isPlainObject(nested)) return
		const copy = { ...nested } as Record<string, unknown>
		obj[head] = copy
		applySnapshotNorm(copy, rest, kind)
	}
}

/**
 * Normalizes relationship fields in a snapshot document using the collection's field map.
 * Populated relationship objects are collapsed to plain IDs (or arrays of IDs for has-many),
 * matching the format used by `computeDiff`.
 *
 * Returns a new object — the input is never mutated.
 */
export const normalizeSnapshot = (
	doc: Record<string, unknown>,
	fieldMap: FieldMap
): Record<string, unknown> => {
	const result = { ...doc }
	for (const [path, kind] of fieldMap) {
		if (kind === 'join') continue
		applySnapshotNorm(result, path.split('.'), kind)
	}
	return result
}

export type DiffResult = {
	changedPaths: string[]
	diff: Record<string, { after: unknown; before: unknown }>
}

/**
 * Computes a flat, dot-notation diff between two documents.
 *
 * - Recurses into plain objects to produce granular paths
 * - Arrays of Payload items (objects with `id`) are diffed by item id, not index
 * - Arrays of primitives or objects without `id` are stored as full before/after
 * - Reordering array items records a `field.__order__` entry (only for items present in both arrays)
 * - null and undefined are treated as equal
 * - `updatedAt` and `id` are always excluded
 * - Paths in `excludeFields` are skipped entirely
 * - When `fieldMap` is provided, relationship fields are normalized deterministically
 *   by schema kind rather than runtime heuristics
 *
 * @example
 * computeDiff({ a: { b: 1 } }, { a: { b: 2 } })
 * // => { changedPaths: ['a.b'], diff: { 'a.b': { before: 1, after: 2 } } }
 *
 * @example
 * computeDiff(
 *   { steps: [{ id: 'x', title: 'A' }] },
 *   { steps: [{ id: 'x', title: 'B' }] },
 * )
 * // => { changedPaths: ['steps.x.title'], diff: { 'steps.x.title': { before: 'A', after: 'B' } } }
 */
export const computeDiff = (
	before: Record<string, unknown> | null | undefined,
	after: Record<string, unknown> | null | undefined,
	excludeFields: string[] = [],
	fieldMap?: FieldMap
): DiffResult => {
	const excludeSet = new Set(excludeFields)
	const diff: Record<string, { after: unknown; before: unknown }> = {}

	diffRecursive(before ?? {}, after ?? {}, excludeSet, '', diff, fieldMap)

	return {
		changedPaths: Object.keys(diff),
		diff,
	}
}
