import { describe, expect, it } from 'vitest'
import { checkboxField } from './checkbox'

const t = (key: string) => key

describe('checkboxField', () => {
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
