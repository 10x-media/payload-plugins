import { describe, expect, it } from 'vitest'
import { isTruthyString } from './coerceBoolean'

describe('isTruthyString', () => {
	it('accepts affirmative tokens, trimmed and case-insensitive', () => {
		for (const v of ['true', '1', 'on', 'yes', ' TRUE ', 'Yes']) {
			expect(isTruthyString(v)).toBe(true)
		}
	})

	it('rejects falsy and unrecognized tokens', () => {
		for (const v of ['false', '0', 'off', 'no', '', 'maybe', 'anything']) {
			expect(isTruthyString(v)).toBe(false)
		}
	})
})
