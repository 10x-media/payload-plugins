import { describe, expect, it } from 'vitest'
import { repeaterField } from './repeater'

const t = (key: string) => key
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('repeaterField.validate', () => {
	it('accepts an empty array when minRows is 0', () => {
		expect(repeaterField.validate?.({ value: [], config: {}, ...base })).toBe(true)
	})

	it('accepts rows equal to minRows', () => {
		expect(
			repeaterField.validate?.({ value: [{ name: 'a' }], config: { minRows: 1 }, ...base })
		).toBe(true)
	})

	it('rejects when row count is below minRows', () => {
		const result = repeaterField.validate?.({ value: [], config: { minRows: 2 }, ...base })
		expect(typeof result).toBe('string')
		expect(result).not.toBe(true)
	})

	it('rejects when row count exceeds maxRows', () => {
		const result = repeaterField.validate?.({
			value: [{ a: 1 }, { a: 2 }, { a: 3 }],
			config: { maxRows: 2 },
			...base,
		})
		expect(typeof result).toBe('string')
		expect(result).not.toBe(true)
	})

	it('accepts exactly maxRows rows', () => {
		expect(
			repeaterField.validate?.({
				value: [{ a: 1 }, { a: 2 }],
				config: { maxRows: 2 },
				...base,
			})
		).toBe(true)
	})

	it('treats null/undefined value as empty array', () => {
		expect(repeaterField.validate?.({ value: null, config: {}, ...base })).toBe(true)
		expect(repeaterField.validate?.({ value: undefined, config: {}, ...base })).toBe(true)
	})
})

describe('repeaterField.format', () => {
	it('shows row count', () => {
		const result = repeaterField.format?.({ value: [{}, {}], config: {}, locale: 'en', t })
		expect(typeof result).toBe('string')
		expect(result?.length).toBeGreaterThan(0)
	})

	it('formats empty array', () => {
		const result = repeaterField.format?.({ value: [], config: {}, locale: 'en', t })
		expect(typeof result).toBe('string')
	})

	it('formats null/undefined as 0 rows', () => {
		const result = repeaterField.format?.({ value: null, config: {}, locale: 'en', t })
		expect(typeof result).toBe('string')
	})
})
