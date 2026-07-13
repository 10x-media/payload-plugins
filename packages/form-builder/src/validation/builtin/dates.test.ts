import { describe, expect, it } from 'vitest'
import { maxDateRule } from './maxDate'
import { minDateRule } from './minDate'

const ctx = {
	siblingData: {},
	data: {},
	field: { blockType: 'date', name: 'd' },
	fieldType: 'date',
	operation: 'create' as const,
	event: 'submit' as const,
	locale: 'en',
	message: () => 'bad',
}

describe('minDate/maxDate rules', () => {
	it('minDate passes at or after the bound', () => {
		expect(
			minDateRule.validate({ ...ctx, value: '2024-01-15', params: { min: '2024-01-15' } })
		).toBe(true)
		expect(
			minDateRule.validate({ ...ctx, value: '2024-01-16', params: { min: '2024-01-15' } })
		).toBe(true)
		expect(
			minDateRule.validate({ ...ctx, value: '2024-01-14', params: { min: '2024-01-15' } })
		).toBe('bad')
	})
	it('minDate passes empty values', () => {
		expect(minDateRule.validate({ ...ctx, value: '', params: { min: '2024-01-15' } })).toBe(true)
		expect(minDateRule.validate({ ...ctx, value: null, params: { min: '2024-01-15' } })).toBe(true)
	})
	it('maxDate passes at or before the bound', () => {
		expect(
			maxDateRule.validate({ ...ctx, value: '2024-01-15', params: { max: '2024-01-15' } })
		).toBe(true)
		expect(
			maxDateRule.validate({ ...ctx, value: '2024-01-14', params: { max: '2024-01-15' } })
		).toBe(true)
		expect(
			maxDateRule.validate({ ...ctx, value: '2024-01-16', params: { max: '2024-01-15' } })
		).toBe('bad')
	})
	it('maxDate passes empty values', () => {
		expect(maxDateRule.validate({ ...ctx, value: '', params: { max: '2024-01-15' } })).toBe(true)
		expect(maxDateRule.validate({ ...ctx, value: null, params: { max: '2024-01-15' } })).toBe(true)
	})
})
