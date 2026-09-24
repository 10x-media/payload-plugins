import { getCountries } from 'libphonenumber-js/core'
import { beforeAll, describe, expect, it } from 'vitest'
import {
	callingCodeFor,
	countryOptions,
	emojiFlag,
	isKnownCountry,
	isSupported,
	KNOWN_COUNTRY_CODES,
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
		const { preferred, rest } = countryOptions({ locale: 'en', metadata: max })
		expect(preferred).toEqual([])
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

	it('splits preferred countries out in the order given', () => {
		const { preferred, rest } = countryOptions({
			countries: ['AT', 'CH', 'DE'],
			locale: 'en',
			metadata: max,
			preferredCountries: ['DE', 'CH'],
		})
		expect(preferred.map((o) => o.code)).toEqual(['DE', 'CH'])
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
		const codes = [...offered.preferred, ...offered.rest].map((option) => option.code)
		expect(codes).not.toContain('JP')
		expect(callingCodeFor('JP', max)).toBe('81')
	})

	it('returns undefined rather than throwing for a code the set does not carry', () => {
		expect(callingCodeFor('ZZ' as CountryCode, max)).toBeUndefined()
	})
})
