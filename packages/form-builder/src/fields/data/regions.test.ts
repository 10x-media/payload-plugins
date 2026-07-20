import { describe, expect, it } from 'vitest'
import {
	COUNTRIES,
	countryLabel,
	isCountryCode,
	isUsStateCode,
	US_STATES,
	usStateLabel,
} from './regions'

const wellFormed = (entries: { label: string; value: string }[]) => {
	for (const entry of entries) {
		expect(typeof entry.value).toBe('string')
		expect(entry.value.length).toBeGreaterThan(0)
		expect(typeof entry.label).toBe('string')
		expect(entry.label.length).toBeGreaterThan(0)
	}
}

describe('COUNTRIES', () => {
	it('covers the full ISO 3166-1 alpha-2 set', () => {
		expect(COUNTRIES.length).toBeGreaterThanOrEqual(240)
	})

	it('has unique, well-formed two-letter codes', () => {
		wellFormed(COUNTRIES)
		const codes = COUNTRIES.map((country) => country.value)
		expect(new Set(codes).size).toBe(codes.length)
		expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
	})

	it('includes known anchors', () => {
		expect(countryLabel('US')).toBe('United States of America')
		expect(countryLabel('DE')).toBe('Germany')
		expect(countryLabel('JP')).toBe('Japan')
	})
})

describe('US_STATES', () => {
	it('lists the 50 states plus DC', () => {
		expect(US_STATES).toHaveLength(51)
	})

	it('has unique, well-formed two-letter codes', () => {
		wellFormed(US_STATES)
		const codes = US_STATES.map((state) => state.value)
		expect(new Set(codes).size).toBe(codes.length)
		expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
	})

	it('includes known anchors', () => {
		expect(usStateLabel('CA')).toBe('California')
		expect(usStateLabel('DC')).toBe('District of Columbia')
	})
})

describe('membership helpers', () => {
	it('recognizes known codes and rejects unknown ones', () => {
		expect(isCountryCode('FR')).toBe(true)
		expect(isCountryCode('ZZ')).toBe(false)
		expect(isUsStateCode('NY')).toBe(true)
		expect(isUsStateCode('ZZ')).toBe(false)
	})

	it('returns undefined labels for unknown codes', () => {
		expect(countryLabel('ZZ')).toBeUndefined()
		expect(usStateLabel('ZZ')).toBeUndefined()
	})
})
