import { describe, expect, it } from 'vitest'
import { patternRule } from './pattern'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'text', name: 'x' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'nope',
}

describe('patternRule', () => {
	it('passes a matching value and empty', () => {
		expect(
			patternRule.validate({ ...ctx, value: 'AB12', params: { pattern: '^[A-Z0-9]+$' } })
		).toBe(true)
		expect(patternRule.validate({ ...ctx, value: '', params: { pattern: '^x$' } })).toBe(true)
	})
	it('fails a non-matching value', () => {
		expect(patternRule.validate({ ...ctx, value: 'ab', params: { pattern: '^[A-Z]+$' } })).toBe(
			'nope'
		)
	})
	it('passes when the pattern is invalid (cannot construct a regex)', () => {
		expect(patternRule.validate({ ...ctx, value: 'x', params: { pattern: '(' } })).toBe(true)
	})
})
