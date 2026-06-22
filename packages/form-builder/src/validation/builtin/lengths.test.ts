import { describe, expect, it } from 'vitest'
import { maxLengthRule } from './maxLength'
import { minLengthRule } from './minLength'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'text', name: 'x' },
	fieldType: 'text',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: (vars?: Record<string, unknown>) => `min=${vars?.min ?? vars?.max}`,
}

describe('minLengthRule', () => {
	it('passes when long enough and on empty', () => {
		expect(minLengthRule.validate({ ...ctx, value: 'abc', params: { min: 3 } })).toBe(true)
		expect(minLengthRule.validate({ ...ctx, value: '', params: { min: 3 } })).toBe(true)
	})
	it('fails when too short, with the interpolated message', () => {
		expect(minLengthRule.validate({ ...ctx, value: 'ab', params: { min: 3 } })).toBe('min=3')
	})
})

describe('maxLengthRule', () => {
	it('fails when too long', () => {
		expect(maxLengthRule.validate({ ...ctx, value: 'abcd', params: { max: 3 } })).toBe('min=3')
	})
})
