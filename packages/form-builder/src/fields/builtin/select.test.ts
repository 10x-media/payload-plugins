import { describe, expect, it } from 'vitest'
import { de } from '../../translations/de'
import { en } from '../../translations/en'
import { selectField } from './select'

const t = (key: string) => key

type FieldWithLabel = {
	name: string
	required?: boolean
	defaultValue?: unknown
	admin?: { isClearable?: boolean }
	label?: (args: { t: (key: string) => string }) => string
	fields?: FieldWithLabel[]
	options?: { label?: (args: { t: (key: string) => string }) => string; value: string }[]
}

const optionsField = (selectField.config as FieldWithLabel[]).find((f) => f.name === 'options')
const optionLabelField = optionsField?.fields?.find((f) => f.name === 'label')
const optionValueField = optionsField?.fields?.find((f) => f.name === 'value')
const displayField = (selectField.config as FieldWithLabel[]).find((f) => f.name === 'display')
const config = {
	options: [
		{ label: 'Free', value: 'free' },
		{ label: 'Pro', value: 'pro' },
	],
}
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('selectField', () => {
	it('declares poll eligibility', () => {
		expect(selectField.pollEligible).toBe(true)
	})
	it('accepts a value present in options', () => {
		expect(selectField.validate?.({ value: 'pro', config, ...base })).toBe(true)
	})
	it('rejects a value absent from options', () => {
		expect(selectField.validate?.({ value: 'x', config, ...base })).toBe(
			'formBuilder:validation.select'
		)
	})
	it('accepts any value when no options are configured', () => {
		expect(selectField.validate?.({ value: 'x', config: {}, ...base })).toBe(true)
	})
	it('formats via the snapshot option labels', () => {
		expect(
			selectField.format?.({ value: 'pro', config, optionLabels: { pro: 'Pro' }, locale: 'en', t })
		).toBe('Pro')
	})
	it('falls back to the raw value when no label is known', () => {
		expect(selectField.format?.({ value: 'pro', config, locale: 'en', t })).toBe('pro')
	})
	it('does not require an option label; the value stands alone', () => {
		expect(optionLabelField?.required).toBeFalsy()
	})
})

// The array field's own labels already say "Option"/"Options" (labels.singular/plural), so the
// row's sub-fields say just "Label"/"Value" rather than repeating "Option label"/"Option value".
describe('option label/value sub-field labels', () => {
	it('resolve to "Label"/"Value" in en', () => {
		const fakeT = (key: string) => en[key as keyof typeof en] ?? key
		expect(optionLabelField?.label?.({ t: fakeT })).toBe('Label')
		expect(optionValueField?.label?.({ t: fakeT })).toBe('Value')
	})

	it('resolve to "Bezeichnung"/"Wert" in de', () => {
		const fakeT = (key: string) => de[key as keyof typeof de] ?? key
		expect(optionLabelField?.label?.({ t: fakeT })).toBe('Bezeichnung')
		expect(optionValueField?.label?.({ t: fakeT })).toBe('Wert')
	})
})

describe('select display config field', () => {
	it('is optional, not clearable, defaulting to dropdown', () => {
		expect(displayField?.required).toBeFalsy()
		expect(displayField?.defaultValue).toBe('dropdown')
		expect(displayField?.admin?.isClearable).toBe(false)
	})

	it('offers exactly dropdown, radio, buttons', () => {
		expect(displayField?.options?.map((option) => option.value)).toEqual([
			'dropdown',
			'radio',
			'buttons',
		])
	})

	it('localizes every display option label via a function', () => {
		for (const option of displayField?.options ?? []) {
			expect(typeof option.label).toBe('function')
		}
	})

	it('resolves display option labels to en strings', () => {
		const fakeT = (key: string) => en[key as keyof typeof en] ?? key
		const labels = displayField?.options?.map((option) => option.label?.({ t: fakeT }))
		expect(labels).toEqual(['Dropdown', 'Radio buttons', 'Buttons'])
	})

	it('resolves display option labels to de strings', () => {
		const fakeT = (key: string) => de[key as keyof typeof de] ?? key
		const labels = displayField?.options?.map((option) => option.label?.({ t: fakeT }))
		expect(labels).toEqual(['Dropdown', 'Optionsfelder', 'Schaltflächen'])
	})
})
