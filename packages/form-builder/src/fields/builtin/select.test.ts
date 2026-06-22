import { describe, expect, it } from 'vitest'
import { selectField } from './select'

const t = (key: string) => key
const config = {
	options: [
		{ label: 'Free', value: 'free' },
		{ label: 'Pro', value: 'pro' },
	],
}
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('selectField', () => {
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
})
