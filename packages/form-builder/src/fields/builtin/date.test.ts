import { describe, expect, it } from 'vitest'
import { dateField } from './date'

const t = (key: string) => key
const base = { config: {}, siblingData: {}, data: {}, locale: 'en', t }

describe('dateField', () => {
	it('accepts a well-formed calendar date', () => {
		expect(dateField.validate?.({ value: '2024-01-15', ...base })).toBe(true)
	})
	it('accepts empty values', () => {
		expect(dateField.validate?.({ value: null, ...base })).toBe(true)
		expect(dateField.validate?.({ value: undefined, ...base })).toBe(true)
		expect(dateField.validate?.({ value: '', ...base })).toBe(true)
	})
	it('rejects a value that does not match YYYY-MM-DD', () => {
		expect(dateField.validate?.({ value: '2024/01/15', ...base })).toBe(
			'formBuilder:validation.date'
		)
		expect(dateField.validate?.({ value: '15-01-2024', ...base })).toBe(
			'formBuilder:validation.date'
		)
		expect(dateField.validate?.({ value: 'not-a-date', ...base })).toBe(
			'formBuilder:validation.date'
		)
	})
	it('rejects a value matching the shape but not a real calendar date', () => {
		expect(dateField.validate?.({ value: '2024-02-30', ...base })).toBe(
			'formBuilder:validation.date'
		)
		expect(dateField.validate?.({ value: '2024-13-01', ...base })).toBe(
			'formBuilder:validation.date'
		)
	})
	it('accepts a leap-day date in a leap year', () => {
		expect(dateField.validate?.({ value: '2024-02-29', ...base })).toBe(true)
	})
	it('formats as the raw string, unchanged', () => {
		expect(dateField.format?.({ value: '2024-01-15', config: {}, locale: 'en', t })).toBe(
			'2024-01-15'
		)
	})
	it('formats a nullish value as an empty string', () => {
		expect(dateField.format?.({ value: null, config: {}, locale: 'en', t })).toBe('')
	})
})
