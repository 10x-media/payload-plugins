import { describe, expect, it } from 'vitest'
import { COUNTRIES } from '../data/regions'
import { countryField } from './country'

const t = (key: string) => key
const base = { config: {}, siblingData: {}, data: {}, locale: 'en', t }

describe('countryField', () => {
	it('is a text-valued field with no author-facing options config', () => {
		expect(countryField.value).toBe('text')
		expect(countryField.config ?? []).toEqual([])
	})

	it('declares poll eligibility and resolves the fixed dataset as poll options', () => {
		expect(countryField.pollEligible).toBe(true)
		const options = countryField.resolveOptions?.({
			instance: { blockType: 'country', name: 'country' },
			form: { id: 1 },
			payload: {} as never,
		})
		expect(options).toBe(COUNTRIES)
	})

	it('accepts a known ISO country code', () => {
		expect(countryField.validate?.({ value: 'US', ...base })).toBe(true)
	})

	it('rejects an unknown code', () => {
		expect(countryField.validate?.({ value: 'ZZ', ...base })).toBe('formBuilder:validation.country')
	})

	it('accepts an empty value (required is enforced by the engine)', () => {
		expect(countryField.validate?.({ value: '', ...base })).toBe(true)
		expect(countryField.validate?.({ value: null, ...base })).toBe(true)
	})

	it('formats a code to its country name', () => {
		expect(countryField.format?.({ value: 'DE', ...base })).toBe('Germany')
	})

	it('falls back to the raw value for an unknown code and empty for none', () => {
		expect(countryField.format?.({ value: 'ZZ', ...base })).toBe('ZZ')
		expect(countryField.format?.({ value: '', ...base })).toBe('')
	})
})
