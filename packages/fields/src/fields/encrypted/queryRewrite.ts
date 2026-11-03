import type {
	CollectionAfterReadHook,
	CollectionBeforeOperationHook,
	CollectionConfig,
	GlobalAfterReadHook,
	GlobalConfig,
	PayloadRequest,
	Where,
} from 'payload'
import { computeBidx } from './crypto/bidx'
import type { KeyRing } from './crypto/keys'
import { contextMode, ringForRequest } from './hooks'
import { queryableOnly, scanEncryptedFields } from './scan'
import type { EncryptedFieldMarker } from './types'

type RingResolver = (marker: EncryptedFieldMarker) => Promise<KeyRing>

type UnsupportedWarn = (path: string, operator: string) => void

/**
 * A blind index answers exact-match only. An unsupported operator is rewritten
 * to this sentinel so the query matches nothing: every real index value is a
 * 24-char base64url string, and a single space is not one. Exported for tests.
 */
export const BIDX_NO_MATCH = ' '

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const rewriteConstraint = async (args: {
	constraint: Record<string, unknown>
	marker: EncryptedFieldMarker
	ringFor: RingResolver
	warn: (operator: string) => void
}): Promise<Record<string, unknown>> => {
	const { constraint, marker, ringFor, warn } = args
	const ring = await ringFor(marker)
	const toBidx = (value: unknown): unknown =>
		value === null ? null : computeBidx(value, ring.indexKey, marker.normalize)
	// Payload's REST layer delivers `in`/`not_in` as a comma-joined string, the
	// admin and Local API as an array; hash each element under either shape.
	const toBidxArray = (value: unknown): unknown[] => {
		const items = Array.isArray(value)
			? value
			: typeof value === 'string'
				? value.split(',').map((item) => item.trim())
				: []
		return items.map(toBidx)
	}
	const rewritten: Record<string, unknown> = {}
	for (const [operator, operand] of Object.entries(constraint)) {
		switch (operator) {
			case 'equals':
				rewritten.equals = toBidx(operand)
				break
			case 'not_equals':
				rewritten.not_equals = toBidx(operand)
				break
			case 'in':
				rewritten.in = toBidxArray(operand)
				break
			case 'not_in':
				rewritten.not_in = toBidxArray(operand)
				break
			case 'exists':
				// The blind index is written iff the source has a value, so its
				// existence tracks the source's. The boolean passes through unhashed.
				rewritten.exists = operand
				break
			default:
				// Substring, range, comparison, and geo operators cannot run over a
				// blind index. Match nothing rather than querying the ciphertext
				// column, which would read as a working filter while returning junk.
				warn(operator)
				return { equals: BIDX_NO_MATCH }
		}
	}
	return rewritten
}

/** Recursively rewrites queryable encrypted paths to their blind-index siblings. */
export const rewriteWhereForMarkers = async (args: {
	markers: ReadonlyMap<string, EncryptedFieldMarker>
	ringFor: RingResolver
	warn?: UnsupportedWarn
	where: Where
}): Promise<Where> => {
	const { markers, ringFor, warn = () => {}, where } = args
	const out: Where = {}
	for (const [key, value] of Object.entries(where)) {
		if ((key === 'and' || key === 'or') && Array.isArray(value)) {
			out[key] = await Promise.all(
				value.map((nested) =>
					rewriteWhereForMarkers({ markers, ringFor, warn, where: nested as Where })
				)
			)
			continue
		}
		const marker = markers.get(key)
		if (marker?.bidxName && isPlainObject(value)) {
			const rewritten = await rewriteConstraint({
				constraint: value,
				marker,
				ringFor,
				warn: (operator) => warn(key, operator),
			})
			const bidxPath = key.includes('.')
				? `${key.slice(0, key.lastIndexOf('.') + 1)}${marker.bidxName}`
				: marker.bidxName
			out[bidxPath] = { ...(out[bidxPath] as Record<string, unknown>), ...rewritten }
			continue
		}
		out[key] = value as Where[string]
	}
	return out
}

const makeHook = (
	markers: ReadonlyMap<string, EncryptedFieldMarker>
): CollectionBeforeOperationHook => {
	return async ({ args, req }) => {
		if (isPlainObject(args) && 'where' in args && isPlainObject(args.where)) {
			const payloadReq = req as PayloadRequest
			const where = await rewriteWhereForMarkers({
				markers,
				ringFor: (marker) => ringForRequest(payloadReq, marker),
				warn: (path, operator) =>
					payloadReq.payload?.logger?.warn?.(
						`@10x-media/fields: operator '${operator}' cannot run on the encrypted field '${path}'. Blind-index filtering supports exact match only (equals, not_equals, in, not_in, exists); this constraint will match nothing.`
					),
				where: args.where as Where,
			})
			return { ...args, where }
		}
		return args
	}
}

const bidxPathFor = (path: string, bidxName: string): string =>
	path.includes('.') ? `${path.slice(0, path.lastIndexOf('.') + 1)}${bidxName}` : bidxName

const deleteAtPath = (doc: Record<string, unknown>, path: string): void => {
	const segments = path.split('.')
	let node: Record<string, unknown> = doc
	for (const segment of segments.slice(0, -1)) {
		const next = node[segment]
		if (!next || typeof next !== 'object') {
			return
		}
		node = next as Record<string, unknown>
	}
	delete node[segments[segments.length - 1] as string]
}

/**
 * Removes server-only encrypted paths from read results: blind-index hashes (so
 * the keyed index value never leaves the server), richText ciphertext siblings
 * (opaque strings the virtual editor field replaces), and write-only fields
 * (whose sealed value passes afterRead untouched and must not surface at all).
 * `admin.hidden` keeps the siblings readable by the plugin's own hooks but,
 * unlike top-level `hidden`, does not strip them from responses.
 */
const makeStripPathsHook = (paths: string[]): CollectionAfterReadHook & GlobalAfterReadHook => {
	return ({ context, doc }) => {
		// Bulk utilities (rotate/adopt/remove) read via pageThrough in `raw`
		// context and need the ciphertext + blind-index siblings; stripping them
		// here would make key rotation silently skip every richText field. Only
		// strip on normal reads.
		if (contextMode(context as Record<string, unknown>)) {
			return doc
		}
		for (const path of paths) {
			deleteAtPath(doc as Record<string, unknown>, path)
		}
		return doc
	}
}

/** Response paths a normal read must not surface, per marker kind. */
const stripPathsFor = (markers: ReadonlyMap<string, EncryptedFieldMarker>): string[] => {
	const paths: string[] = []
	for (const [path, marker] of markers) {
		if (marker.queryable && marker.bidxName) {
			paths.push(bidxPathFor(path, marker.bidxName))
		}
		// richText stores its ciphertext under the marker's own scan path
		// (`${name}_encrypted`); the write-only path IS the stored field itself.
		if (marker.sourceType === 'richText' || marker.writeOnly) {
			paths.push(path)
		}
	}
	return paths
}

/** Dot paths of the stored write-only fields, each with the virtual siblings that report on it. */
const writeOnlySiblingsFor = (
	markers: ReadonlyMap<string, EncryptedFieldMarker>
): Array<{ path: string; siblings: string[] }> => {
	const out: Array<{ path: string; siblings: string[] }> = []
	for (const [path, marker] of markers) {
		if (!marker.writeOnly) continue
		const siblings = [marker.setName, marker.hintName]
			.filter((name): name is string => Boolean(name))
			.map((name) => bidxPathFor(path, name))
		if (siblings.length > 0) out.push({ path, siblings })
	}
	return out
}

type SelectNode = { [key: string]: SelectNode | boolean }

type SelectFunction = (
	args: Parameters<NonNullable<CollectionConfig['select']>>[0]
) => Parameters<NonNullable<CollectionConfig['select']>>[0]['select']

const selectedAt = (select: SelectNode, path: string): boolean => {
	let node: SelectNode | boolean | undefined = select
	for (const segment of path.split('.')) {
		if (!node || typeof node !== 'object') return false
		node = node[segment]
	}
	return node === true || (typeof node === 'object' && node !== null)
}

const withSelectedAt = (select: SelectNode, path: string): SelectNode => {
	const [head, ...rest] = path.split('.') as [string, ...string[]]
	if (rest.length === 0) return { ...select, [head]: true }
	const child = select[head]
	if (child === true) return select
	return {
		...select,
		[head]: withSelectedAt(typeof child === 'object' ? child : {}, rest.join('.')),
	}
}

/**
 * Selecting a write-only field also selects its `_set` and `_hint` siblings: the list view
 * queries only its visible columns, and the write-only cell reads set-ness and the hint
 * from those siblings, since the stored value itself never leaves the server. An exclude-mode
 * select already returns them unless it excludes them by name.
 */
const makeWriteOnlySelect = (
	entries: Array<{ path: string; siblings: string[] }>,
	prior: CollectionConfig['select']
): NonNullable<CollectionConfig['select']> => {
	const selectFn: SelectFunction = (args) => {
		const resolved = prior ? prior(args) : undefined
		const select = (resolved === undefined ? args.select : resolved) as SelectNode | undefined
		if (!select || Object.values(select).some((value) => value === false)) return resolved
		let next = select
		for (const { path, siblings } of entries) {
			if (!selectedAt(next, path)) continue
			for (const sibling of siblings) next = withSelectedAt(next, sibling)
		}
		return next === select ? resolved : (next as typeof args.select)
	}
	// A collection typed against generated types narrows the return to its include shape;
	// adding sibling keys keeps an include select an include select.
	return selectFn as NonNullable<CollectionConfig['select']>
}

/**
 * Attaches the blind-index where-rewrite and response stripper to a collection.
 * The fields() plugin applies this to every collection automatically; call it
 * directly only when using encryptedField() standalone without the plugin.
 */
export const withEncryptedQueryRewrite = (collection: CollectionConfig): CollectionConfig => {
	const allMarkers = scanEncryptedFields(collection.fields)
	const queryableMarkers = queryableOnly(allMarkers)
	const stripPaths = stripPathsFor(allMarkers)
	if (queryableMarkers.size === 0 && stripPaths.length === 0) {
		return collection
	}
	const hooks: NonNullable<CollectionConfig['hooks']> = { ...collection.hooks }
	if (stripPaths.length > 0) {
		hooks.afterRead = [...(collection.hooks?.afterRead ?? []), makeStripPathsHook(stripPaths)]
	}
	if (queryableMarkers.size > 0) {
		hooks.beforeOperation = [
			makeHook(queryableMarkers),
			...(collection.hooks?.beforeOperation ?? []),
		]
	}
	const writeOnly = writeOnlySiblingsFor(allMarkers)
	if (writeOnly.length > 0) {
		return { ...collection, hooks, select: makeWriteOnlySelect(writeOnly, collection.select) }
	}
	return { ...collection, hooks }
}

/**
 * Attaches the response stripper to a global. Globals take no `where`, so this
 * is the strip alone: blind-index hashes, richText ciphertext siblings, and
 * write-only fields never surface in a read result. The fields() plugin applies
 * this to every global automatically; call it directly only when using
 * encryptedField() standalone without the plugin.
 */
export const withEncryptedResponseStrip = (global: GlobalConfig): GlobalConfig => {
	const stripPaths = stripPathsFor(scanEncryptedFields(global.fields))
	if (stripPaths.length === 0) {
		return global
	}
	return {
		...global,
		hooks: {
			...global.hooks,
			afterRead: [...(global.hooks?.afterRead ?? []), makeStripPathsHook(stripPaths)],
		},
	}
}
