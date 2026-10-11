import { describe, expect, it } from 'vitest'
import { CURRENCY_CODES, currencyOptions } from './currencyOptions'

describe('currencyOptions', () => {
	it('names each currency in the admin language, followed by its code', () => {
		expect(currencyOptions('en')).toContainEqual({ label: 'Euro (EUR)', value: 'EUR' })
		expect(currencyOptions('en')).toContainEqual({ label: 'US Dollar (USD)', value: 'USD' })
		expect(currencyOptions('de')).toContainEqual({ label: 'US-Dollar (USD)', value: 'USD' })
		expect(currencyOptions('fr')).toContainEqual({
			label: 'dollar des États-Unis (USD)',
			value: 'USD',
		})
	})

	it('offers about thirty widely used codes, sorted by name', () => {
		const options = currencyOptions('en')
		expect(CURRENCY_CODES.length).toBeGreaterThanOrEqual(25)
		expect(CURRENCY_CODES.length).toBeLessThanOrEqual(40)
		expect(CURRENCY_CODES.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true)
		expect(options.map((option) => option.value).sort()).toEqual([...CURRENCY_CODES].sort())
		const labels = options.map((option) => option.label)
		expect(labels).toEqual([...labels].sort(new Intl.Collator('en').compare))
	})

	it('still offers a stored value the list lacks, and nothing twice', () => {
		expect(currencyOptions('en', ['XOF'])).toContainEqual({
			label: 'West African CFA Franc (XOF)',
			value: 'XOF',
		})
		expect(currencyOptions('en', ['euro'])).toContainEqual({ label: 'euro', value: 'euro' })
		expect(currencyOptions('en', ['EUR', undefined, ''])).toHaveLength(CURRENCY_CODES.length)
	})
})
