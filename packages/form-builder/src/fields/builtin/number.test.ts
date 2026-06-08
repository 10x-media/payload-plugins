import { describe, expect, it } from 'vitest'
import { numberField } from './number'

const t = (key: string) => key
const base = { config: {}, siblingData: {}, data: {}, locale: 'en', t }

describe('numberField', () => {
	it('accepts a finite number', () => {
		expect(numberField.validate?.({ value: 42, ...base })).toBe(true)
	})
	it('rejects NaN with the i18n key', () => {
		expect(numberField.validate?.({ value: Number.NaN, ...base })).toBe(
			'formBuilder:validation.number'
		)
	})
	it('formats as a string', () => {
		expect(numberField.format?.({ value: 42, config: {}, locale: 'en', t })).toBe('42')
	})
})
