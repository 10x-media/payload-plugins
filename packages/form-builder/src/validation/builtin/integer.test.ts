import { describe, expect, it } from 'vitest'
import { integerRule } from './integer'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'number', name: 'n' },
	fieldType: 'number',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
	params: {},
}

describe('integerRule', () => {
	it('accepts whole numbers and empty values', () => {
		expect(integerRule.validate({ ...ctx, value: 3 })).toBe(true)
		expect(integerRule.validate({ ...ctx, value: 0 })).toBe(true)
		expect(integerRule.validate({ ...ctx, value: -7 })).toBe(true)
		expect(integerRule.validate({ ...ctx, value: null })).toBe(true)
		expect(integerRule.validate({ ...ctx, value: undefined })).toBe(true)
	})
	it('rejects a fractional number', () => {
		expect(integerRule.validate({ ...ctx, value: 3.5 })).toBe('bad')
	})
})
