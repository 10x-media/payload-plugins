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
		expect(() => normalizeHint({ prefix: 20, suffix: 13 }, 'k')).toThrow(/at most 32/)
	})

	it('accepts a budget wide enough for a constant format prefix', () => {
		// `sk_live_` and friends identify the format, not the key, so a hint has to
		// clear the prefix before its characters start distinguishing anything.
		expect(normalizeHint({ prefix: 14, suffix: 6 }, 'k')).toEqual({ prefix: 14, suffix: 6 })
		expect(normalizeHint({ prefix: 16, suffix: 16 }, 'k')).toEqual({ prefix: 16, suffix: 16 })
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

	it('will not expose more than it hides, however wide the config', () => {
		const wide = { prefix: 12, suffix: 8 }
		// 20 exposed needs 20 hidden, so 39 characters is one short and 40 is not.
		expect(makeHint('a'.repeat(39), wide)).toBeNull()
		expect(makeHint('b'.repeat(40), wide)).toBe(`${'b'.repeat(12)}····${'b'.repeat(8)}`)
	})

	/**
	 * The ratio guard is what lets one config serve a collection holding keys of
	 * different lengths: the long ones get a hint, the short ones quietly get
	 * none, rather than the config deciding how much of a short key to expose.
	 */
	it('declines the short values a wide config cannot safely slice', () => {
		const wide = { prefix: 14, suffix: 6 }
		expect(makeHint('sk_live_51H8xQ2eZvKYlo2C9d3f', wide)).toBeNull()
		expect(makeHint(`sk_live_51H8xQ${'2eZvKYlo'.repeat(3)}9d3fXQ`, wide)).toBe(
			'sk_live_51H8xQ····9d3fXQ'
		)
	})

	it('still refuses a value shorter than the absolute floor at any ratio', () => {
		// 2 exposed of 9 clears the ratio comfortably and still fails the floor.
		expect(makeHint('123456789', { prefix: 1, suffix: 1 })).toBeNull()
		expect(makeHint('1234567890', { prefix: 1, suffix: 1 })).toBe('1····0')
	})

	it('display formatting swaps the canonical gap for the maskDots bullet run', () => {
		expect(formatHint('sk_d····9d3f', 8)).toBe('sk_d••••••••9d3f')
		expect(formatHint('····1b4c', 3)).toBe('•••1b4c')
		// A string without the gap (defensive) passes through untouched.
		expect(formatHint('plain', 8)).toBe('plain')
	})

	/**
	 * The run is additive around the hint's ends, never reduced by them: the
	 * count is `maskDots` alone, the same run every concealed span shows, so a
	 * hinted value and a hint-less one read as the same kind of thing. Overflow
	 * in a narrow container is handled by the container's ellipsis, not here.
	 */
	it('keeps the full maskDots run however wide the exposed ends are', () => {
		expect(formatHint('sk_live_51H8xQ····9d3fXQ', 8)).toBe('sk_live_51H8xQ••••••••9d3fXQ')
		expect(formatHint(`${'a'.repeat(16)}····${'b'.repeat(16)}`, 8)).toBe(
			`${'a'.repeat(16)}${'•'.repeat(8)}${'b'.repeat(16)}`
		)
	})

	it('returns null when an exposed end contains the gap glyph itself', () => {
		// A `·` in the exposed text would blur where the concealed span starts,
		// both for a full marker sequence and for trailing dots adjacent to it.
		expect(makeHint('····abcdefghijklmnop', hint)).toBeNull()
		expect(makeHint('abcdefghijklmnop··cd', hint)).toBeNull()
		expect(makeHint('ab·cdefghijklmnopqrs', hint)).toBeNull()
	})

	it('returns null for non-string plaintext', () => {
		expect(makeHint(1234567890123456, hint)).toBeNull()
		expect(makeHint({ a: 1 }, hint)).toBeNull()
		expect(makeHint(null, hint)).toBeNull()
	})
})
