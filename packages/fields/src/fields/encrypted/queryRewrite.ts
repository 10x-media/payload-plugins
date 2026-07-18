import type {
	CollectionBeforeOperationHook,
	CollectionConfig,
	PayloadRequest,
	Where,
} from 'payload'
import { computeBidx } from './crypto/bidx'
import type { KeyRing } from './crypto/keys'
import { ringForRequest } from './hooks'
import { queryableOnly, scanEncryptedFields } from './scan'
import type { EncryptedFieldMarker } from './types'

type RingResolver = (marker: EncryptedFieldMarker) => Promise<KeyRing>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const rewriteConstraint = async (
	constraint: Record<string, unknown>,
	marker: EncryptedFieldMarker,
	ringFor: RingResolver
): Promise<{ leftover?: Record<string, unknown>; rewritten?: Record<string, unknown> }> => {
	const rewritten: Record<string, unknown> = {}
	const leftover: Record<string, unknown> = {}
	const ring = await ringFor(marker)
	const toBidx = (value: unknown): unknown =>
		value === null ? null : computeBidx(value, ring.indexKey, marker.normalize)
	for (const [operator, operand] of Object.entries(constraint)) {
		if (operator === 'equals') {
			rewritten.equals = toBidx(operand)
		} else if (operator === 'in' && Array.isArray(operand)) {
			rewritten.in = operand.map(toBidx)
		} else {
			// Unsupported operators stay on the ciphertext column and match
			// nothing deterministic; documented limitation (equals/in only).
			leftover[operator] = operand
		}
	}
	return {
		leftover: Object.keys(leftover).length > 0 ? leftover : undefined,
		rewritten: Object.keys(rewritten).length > 0 ? rewritten : undefined,
	}
}

/** Recursively rewrites queryable encrypted paths to their blind-index siblings. */
export const rewriteWhereForMarkers = async (
	where: Where,
	markers: Map<string, EncryptedFieldMarker>,
	ringFor: RingResolver
): Promise<Where> => {
	const out: Where = {}
	for (const [key, value] of Object.entries(where)) {
		if ((key === 'and' || key === 'or') && Array.isArray(value)) {
			out[key] = await Promise.all(
				value.map((nested) => rewriteWhereForMarkers(nested as Where, markers, ringFor))
			)
			continue
		}
		const marker = markers.get(key)
		if (marker?.bidxName && isPlainObject(value)) {
			const { leftover, rewritten } = await rewriteConstraint(value, marker, ringFor)
			const bidxPath = key.includes('.')
				? `${key.slice(0, key.lastIndexOf('.') + 1)}${marker.bidxName}`
				: marker.bidxName
			if (rewritten) {
				out[bidxPath] = { ...(out[bidxPath] as Record<string, unknown>), ...rewritten }
			}
			if (leftover) {
				out[key] = leftover
			}
			continue
		}
		out[key] = value as Where[string]
	}
	return out
}

const makeHook = (markers: Map<string, EncryptedFieldMarker>): CollectionBeforeOperationHook => {
	return async ({ args, req }) => {
		if (isPlainObject(args) && 'where' in args && isPlainObject(args.where)) {
			const where = await rewriteWhereForMarkers(args.where as Where, markers, (marker) =>
				ringForRequest(req as PayloadRequest, marker)
			)
			return { ...args, where }
		}
		return args
	}
}

/**
 * Attaches the blind-index where-rewrite to a collection. The fields() plugin
 * applies this to every collection automatically; call it directly only when
 * using encryptedField() standalone without the plugin.
 */
export const withEncryptedQueryRewrite = (collection: CollectionConfig): CollectionConfig => {
	const markers = queryableOnly(scanEncryptedFields(collection.fields))
	if (markers.size === 0) {
		return collection
	}
	return {
		...collection,
		hooks: {
			...collection.hooks,
			beforeOperation: [makeHook(markers), ...(collection.hooks?.beforeOperation ?? [])],
		},
	}
}
