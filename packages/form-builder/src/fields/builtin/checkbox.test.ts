import { describe, expect, it } from 'vitest'
import { checkboxField } from './checkbox'

const t = (key: string) => key
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('checkboxField', () => {
	it('omits placeholder from the shared config', () => {
		expect(checkboxField.omitShared).toEqual(['placeholder'])
	})

	it('validates: required + an explicit false -> error', () => {
		const result = checkboxField.validate?.({ ...base, value: false, config: { required: true } })
		expect(result).toBe('formBuilder:validation.required')
	})

	it('validates: required + undefined -> error', () => {
		const result = checkboxField.validate?.({
			...base,
			value: undefined,
			config: { required: true },
		})
		expect(result).toBe('formBuilder:validation.required')
	})

	it('validates: required + true -> valid', () => {
		const result = checkboxField.validate?.({ ...base, value: true, config: { required: true } })
		expect(result).toBe(true)
	})

	it('validates: optional + false -> valid', () => {
		expect(checkboxField.validate?.({ ...base, value: false, config: {} })).toBe(true)
		expect(checkboxField.validate?.({ ...base, value: false, config: { required: false } })).toBe(
			true
		)
	})

	it('formats true as Yes', () => {
		expect(checkboxField.format?.({ value: true, config: {}, locale: 'en', t })).toBe(
			'formBuilder:format.yes'
		)
	})
	it('formats false as No', () => {
		expect(checkboxField.format?.({ value: false, config: {}, locale: 'en', t })).toBe(
			'formBuilder:format.no'
		)
	})
})
