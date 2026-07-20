import { createHmac } from 'node:crypto'

/** Truncated to 24 base64url chars (144 bits): far beyond collision concern, short enough to index. */
export const BIDX_LENGTH = 24

export type BidxNormalize = 'email' | 'standard'

/** Thrown when a non-scalar value is handed to the blind index. */
export class BidxValueError extends Error {
	constructor(value: unknown) {
		const kind = value === null ? 'null' : typeof value
		super(`@10x-media/fields: blind index requires a string or number value, received ${kind}`)
		this.name = 'BidxValueError'
	}
}

/**
 * Normalization must be identical at write and query time or lookups miss.
 * Only scalar string/number is accepted: a naive String() would collapse every
 * object to "[object Object]", null to "null" (colliding with the string
 * "null"), and arrays to a comma-join, all silently sharing one blind index.
 * Email lowercases (case-insensitive addressing); everything trims.
 */
export const normalizeForBidx = (value: unknown, mode: BidxNormalize): string => {
	if (typeof value !== 'string' && typeof value !== 'number') {
		throw new BidxValueError(value)
	}
	const text = String(value).trim()
	return mode === 'email' ? text.toLowerCase() : text
}

/** Keyed blind index: HMAC-SHA256 under a dedicated HKDF-derived index key. */
export const computeBidx = (value: unknown, indexKey: Buffer, mode: BidxNormalize): string =>
	createHmac('sha256', indexKey)
		.update(normalizeForBidx(value, mode), 'utf8')
		.digest('base64url')
		.slice(0, BIDX_LENGTH)
