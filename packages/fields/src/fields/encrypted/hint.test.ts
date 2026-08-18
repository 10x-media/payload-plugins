import { describe, expect, it } from 'vitest'
import { formatHint, makeHint, normalizeHint } from './hint'

describe('normalizeHint', () => {
	it('defaults missing sides to zero and keeps given values', () => {
		expect(normalizeHint({ prefix: 4, suffix: 4 }, 'k')).toEqual({ prefix: 4, suffix: 4 })
		expect(normalizeHint({ suffix: 4 }, 'k')).toEqual({ prefix: 0, suffix: 4 })
	})

	it('rejects empty, negative, fractional, and over-cap configs', () => {
		expect(() => normalizeHint({}, 'k')).toThrow(/at least one character/)
		expect(() => normalizeHint({ prefix: -1, suffix: 4 }, 'k')).toThrow(/non-negative/)
		expect(() => normalizeHint({ prefix: 1.5 }, 'k')).toThrow(/non-negative/)
		expect(() => normalizeHint({ prefix: 5, suffix: 4 }, 'k')).toThrow(/at most 8/)
	})
})

describe('makeHint', () => {
	const hint = { prefix: 4, suffix: 4 }

	it('exposes the configured ends around a fixed gap', () => {
		expect(makeHint('sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f', hint)).toBe('sk_d····9d3f')
		expect(makeHint('whsec_0a1b2c3d4e5f', { prefix: 0, suffix: 4 })).toBe('····4e5f')
	})

	it('returns null for short plaintexts (hint would reconstruct the secret)', () => {
		// prefix 4 + suffix 4 + 8 hidden = 16 minimum
		expect(makeHint('fifteen-chars15'.slice(0, 15), hint)).toBeNull()
		expect(makeHint('sixteen-chars-16', hint)).toBe('sixt····s-16')
	})

	it('display formatting swaps the canonical gap for the maskDots bullet run', () => {
		expect(formatHint('sk_d····9d3f', 8)).toBe('sk_d••••••••9d3f')
		expect(formatHint('····1b4c', 3)).toBe('•••1b4c')
		// A string without the gap (defensive) passes through untouched.
		expect(formatHint('plain', 8)).toBe('plain')
	})

	it('returns null for non-string plaintext', () => {
		expect(makeHint(1234567890123456, hint)).toBeNull()
		expect(makeHint({ a: 1 }, hint)).toBeNull()
		expect(makeHint(null, hint)).toBeNull()
	})
})
