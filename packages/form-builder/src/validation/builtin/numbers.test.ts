import { describe, expect, it } from 'vitest'
import { maxRule } from './max'
import { minRule } from './min'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'number', name: 'n' },
	fieldType: 'number',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
}

describe('min/max number rules', () => {
	it('min passes at or above the bound', () => {
		expect(minRule.validate({ ...ctx, value: 5, params: { min: 5 } })).toBe(true)
		expect(minRule.validate({ ...ctx, value: 4, params: { min: 5 } })).toBe('bad')
	})
	it('max passes at or below the bound', () => {
		expect(maxRule.validate({ ...ctx, value: 5, params: { max: 5 } })).toBe(true)
		expect(maxRule.validate({ ...ctx, value: 6, params: { max: 5 } })).toBe('bad')
	})
})
