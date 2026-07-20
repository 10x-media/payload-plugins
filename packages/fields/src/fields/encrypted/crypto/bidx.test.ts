import { describe, expect, it } from 'vitest'
import { BidxValueError, computeBidx, normalizeForBidx } from './bidx'
import { resolveKeys } from './keys'

const SECRET = 'test-secret-not-for-prod'
const ring = await resolveKeys(undefined, SECRET)

describe('normalizeForBidx', () => {
	it('trims all values and lowercases only email mode', () => {
		expect(normalizeForBidx('  User@Example.com ', 'email')).toBe('user@example.com')
		expect(normalizeForBidx('  MixedCase ', 'standard')).toBe('MixedCase')
		expect(normalizeForBidx(42, 'standard')).toBe('42')
	})

	it('accepts only scalar string/number and rejects everything else (M2)', () => {
		expect(normalizeForBidx('hello', 'standard')).toBe('hello')
		expect(normalizeForBidx(0, 'standard')).toBe('0')
		expect(() => normalizeForBidx({}, 'standard')).toThrow(BidxValueError)
		expect(() => normalizeForBidx(['a', 'b'], 'standard')).toThrow(BidxValueError)
		expect(() => normalizeForBidx(null, 'standard')).toThrow(BidxValueError)
		expect(() => normalizeForBidx(undefined, 'standard')).toThrow(BidxValueError)
		expect(() => normalizeForBidx(true, 'standard')).toThrow(BidxValueError)
	})
})

describe('computeBidx', () => {
	it('matches the golden HMAC-SHA256 vector (truncated b64url, 24 chars)', () => {
		// Computed once with node:crypto against the default indexKey for SECRET.
		expect(computeBidx('user@example.com', ring.indexKey, 'email')).toBe('76n6Ms7MNulV8J7MfEefE-Fm')
	})

	it('is deterministic, normalization-aware, and index-key-dependent', async () => {
		// Post-H2 the index key follows dedicated indexKey material (or the secret),
		// not the active data key, so a distinct bidx needs distinct indexKey material.
		const other = await resolveKeys(
			{
				active: 'k1',
				indexKey: 'dedicated-index-key-material',
				keys: { k1: 'k1-secret-material' },
			},
			SECRET
		)
		const a = computeBidx('User@Example.COM  ', ring.indexKey, 'email')
		expect(a).toBe(computeBidx('user@example.com', ring.indexKey, 'email'))
		expect(a).toHaveLength(24)
		expect(computeBidx('user@example.com', other.indexKey, 'email')).not.toBe(a)
	})
})
