import { createHmac } from 'node:crypto'

/** Truncated to 24 base64url chars (144 bits): far beyond collision concern, short enough to index. */
export const BIDX_LENGTH = 24

export type BidxNormalize = 'email' | 'standard'

/**
 * Normalization must be identical at write and query time or lookups miss.
 * Email lowercases (case-insensitive addressing); everything trims.
 */
export const normalizeForBidx = (value: unknown, mode: BidxNormalize): string => {
	const text = String(value).trim()
	return mode === 'email' ? text.toLowerCase() : text
}

/** Keyed blind index: HMAC-SHA256 under a dedicated HKDF-derived index key. */
export const computeBidx = (value: unknown, indexKey: Buffer, mode: BidxNormalize): string =>
	createHmac('sha256', indexKey)
		.update(normalizeForBidx(value, mode), 'utf8')
		.digest('base64url')
		.slice(0, BIDX_LENGTH)
