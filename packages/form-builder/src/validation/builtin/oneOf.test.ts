import { describe, expect, it } from 'vitest'
import { oneOfRule } from './oneOf'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'select', name: 's' },
	fieldType: 'select',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
}

describe('oneOfRule', () => {
	it('accepts a listed value and passes when values is empty', () => {
		expect(oneOfRule.validate({ ...ctx, value: 'a', params: { values: [{ value: 'a' }] } })).toBe(
			true
		)
		expect(oneOfRule.validate({ ...ctx, value: 'x', params: {} })).toBe(true)
	})
	it('rejects an unlisted value', () => {
		expect(oneOfRule.validate({ ...ctx, value: 'x', params: { values: [{ value: 'a' }] } })).toBe(
			'bad'
		)
	})
})
