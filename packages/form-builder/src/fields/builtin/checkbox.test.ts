import { describe, expect, it } from 'vitest'
import { de } from '../../translations/de'
import { en } from '../../translations/en'
import { checkboxField } from './checkbox'

const t = (key: string) => key
const base = { siblingData: {}, data: {}, locale: 'en', t }

type FieldWithOptions = {
	name: string
	required?: boolean
	defaultValue?: unknown
	admin?: { isClearable?: boolean }
	options?: { label?: (args: { t: (key: string) => string }) => string; value: string }[]
}

const displayField = (checkboxField.config as FieldWithOptions[]).find((f) => f.name === 'display')

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

describe('checkbox display config field', () => {
	it('is optional, not clearable, defaulting to checkbox', () => {
		expect(displayField?.required).toBeFalsy()
		expect(displayField?.defaultValue).toBe('checkbox')
		expect(displayField?.admin?.isClearable).toBe(false)
	})

	it('offers exactly checkbox, switch', () => {
		expect(displayField?.options?.map((option) => option.value)).toEqual(['checkbox', 'switch'])
	})

	it('localizes every display option label via a function', () => {
		for (const option of displayField?.options ?? []) {
			expect(typeof option.label).toBe('function')
		}
	})

	it('resolves display option labels to en strings', () => {
		const fakeT = (key: string) => en[key as keyof typeof en] ?? key
		const labels = displayField?.options?.map((option) => option.label?.({ t: fakeT }))
		expect(labels).toEqual(['Checkbox', 'Switch'])
	})

	it('resolves display option labels to de strings', () => {
		const fakeT = (key: string) => de[key as keyof typeof de] ?? key
		const labels = displayField?.options?.map((option) => option.label?.({ t: fakeT }))
		expect(labels).toEqual(['Checkbox', 'Schalter'])
	})
})
