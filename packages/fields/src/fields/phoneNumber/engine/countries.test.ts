import { getCountries, getCountryCallingCode } from 'libphonenumber-js/core'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	callingCodeFor,
	countryOptions,
	emojiFlag,
	isKnownCountry,
	isSupported,
	KNOWN_COUNTRY_CODES,
	mainCountryForCallingCode,
} from './countries'
import { loadMetadata, type PhoneMetadata } from './metadata'
import type { CountryCode } from './phone'

let max: PhoneMetadata
beforeAll(async () => {
	max = await loadMetadata('max')
})

describe('emojiFlag', () => {
	it('maps an ISO code to two regional indicator symbols', () => {
		expect(emojiFlag('DE')).toBe('\u{1F1E9}\u{1F1EA}')
		expect(emojiFlag('CH')).toBe('\u{1F1E8}\u{1F1ED}')
	})

	it('accepts lower case', () => {
		expect(emojiFlag('de' as CountryCode)).toBe(emojiFlag('DE'))
	})

	it('produces exactly two codepoints for every supported country', () => {
		const { rest } = countryOptions({ locale: 'en', metadata: max })
		for (const option of rest) {
			expect([...emojiFlag(option.code)]).toHaveLength(2)
		}
	})
})

describe('countryOptions', () => {
	it('lists every country libphonenumber supports when unrestricted', () => {
		const { priority, rest } = countryOptions({ locale: 'en', metadata: max })
		expect(priority).toEqual([])
		expect(rest.length).toBeGreaterThan(200)
	})

	it('carries the calling code for each country', () => {
		const { rest } = countryOptions({ countries: ['DE'], locale: 'en', metadata: max })
		expect(rest[0]).toMatchObject({ callingCode: '49', code: 'DE' })
	})

	it('localizes names to the requested locale', () => {
		expect(countryOptions({ countries: ['DE'], locale: 'en', metadata: max }).rest[0]?.name).toBe(
			'Germany'
		)
		expect(countryOptions({ countries: ['DE'], locale: 'de', metadata: max }).rest[0]?.name).toBe(
			'Deutschland'
		)
	})

	it('falls back to the raw code when Intl.DisplayNames rejects the locale tag', () => {
		expect(
			countryOptions({ countries: ['DE'], locale: 'not_a_locale', metadata: max }).rest[0]?.name
		).toBe('DE')
	})

	it('restricts to the allowlist, preserving no duplicates', () => {
		const { rest } = countryOptions({ countries: ['CH', 'DE', 'AT'], locale: 'en', metadata: max })
		expect(rest.map((o) => o.code)).toEqual(['AT', 'DE', 'CH'])
	})

	it('splits priority countries out in the order given', () => {
		const { priority, rest } = countryOptions({
			countries: ['AT', 'CH', 'DE'],
			locale: 'en',
			metadata: max,
			priorityCountries: ['DE', 'CH'],
		})
		expect(priority.map((o) => o.code)).toEqual(['DE', 'CH'])
		expect(rest.map((o) => o.code)).toEqual(['AT'])
	})

	it('sorts the remainder by localized name, not by code', () => {
		const { rest } = countryOptions({ countries: ['DE', 'AT', 'CH'], locale: 'de', metadata: max })
		expect(rest.map((o) => o.name)).toEqual(['Deutschland', 'Österreich', 'Schweiz'])
	})

	it('ignores an unsupported code in the allowlist rather than emitting a broken row', () => {
		const { rest } = countryOptions({
			countries: ['DE', 'ZZ' as CountryCode],
			locale: 'en',
			metadata: max,
		})
		expect(rest.map((o) => o.code)).toEqual(['DE'])
	})
})

describe('isSupported', () => {
	it('accepts a real country', () => {
		expect(isSupported('DE', max)).toBe(true)
	})

	it('rejects a non-country', () => {
		expect(isSupported('ZZ', max)).toBe(false)
	})
})

describe('isKnownCountry', () => {
	it('accepts a real country', () => {
		expect(isKnownCountry('DE')).toBe(true)
	})

	it('rejects a non-country', () => {
		expect(isKnownCountry('ZZ')).toBe(false)
	})

	it('stays in step with the metadata libphonenumber actually ships', async () => {
		const metadata = await loadMetadata('max')
		expect([...KNOWN_COUNTRY_CODES].sort()).toEqual([...getCountries(metadata as never)].sort())
	})
})

describe('callingCodeFor', () => {
	it.each([
		['DE', '49'],
		['US', '1'],
		['JP', '81'],
	])('reads %s off the country itself', (code, expected) => {
		expect(callingCodeFor(code as CountryCode, max)).toBe(expected)
	})

	// The field's `countries` allowlist scopes the picker, never what a calling code is
	it('answers for a country an allowlist would not offer', () => {
		const offered = countryOptions({ countries: ['DE', 'FR'], locale: 'en', metadata: max })
		const codes = [...offered.priority, ...offered.rest].map((option) => option.code)
		expect(codes).not.toContain('JP')
		expect(callingCodeFor('JP', max)).toBe('81')
	})

	it('returns undefined rather than throwing for a code the set does not carry', () => {
		expect(callingCodeFor('ZZ' as CountryCode, max)).toBeUndefined()
	})
})

/** The one shape this module reads straight out of the metadata rather than through an API. */
const callingCodeMap = (metadata: PhoneMetadata): Record<string, readonly string[]> => {
	const map = metadata.country_calling_codes
	if (typeof map !== 'object' || map === null) throw new Error('country_calling_codes is missing')
	return map as Record<string, readonly string[]>
}

describe('mainCountryForCallingCode', () => {
	it.each([
		['1', 'US'],
		['7', 'RU'],
		['41', 'CH'],
		['44', 'GB'],
		['49', 'DE'],
	])('reads +%s as %s', (callingCode, expected) => {
		expect(mainCountryForCallingCode(callingCode, max)).toBe(expected)
	})

	it.each(['', '9', '999', '882'])('has no main country for +%s', (callingCode) => {
		expect(mainCountryForCallingCode(callingCode, max)).toBeUndefined()
	})

	it('answers the same way across every metadata set', async () => {
		const [min, mobile] = await Promise.all([loadMetadata('min'), loadMetadata('mobile')])
		for (const set of [min, mobile]) {
			expect(mainCountryForCallingCode('1', set)).toBe('US')
			expect(mainCountryForCallingCode('44', set)).toBe('GB')
		}
	})

	// A library upgrade that reshapes the map has to fail here rather than silently read nothing
	it('pins the metadata shape it reads', () => {
		const entries = Object.entries(callingCodeMap(max))
		expect(entries.length).toBeGreaterThan(200)
		for (const [callingCode, listed] of entries) {
			expect(callingCode).toMatch(/^\d+$/)
			expect(Array.isArray(listed)).toBe(true)
			expect(listed.length).toBeGreaterThan(0)
			expect(mainCountryForCallingCode(callingCode, max)).toBe(listed[0])
		}
	})

	it('lists every supported country under the calling code it belongs to', () => {
		const map = callingCodeMap(max)
		for (const code of getCountries(max as never)) {
			expect(map[getCountryCallingCode(code, max as never)]).toContain(code)
		}
	})
})
