import { beforeAll, describe, expect, it } from 'vitest'
import {
	callingCodeOf,
	digitCount,
	exceedsPhoneLength,
	isPhoneInput,
	nationalPart,
	phoneSeed,
	provisionalCountry,
} from './draft'
import { loadMetadata, type PhoneMetadata } from './metadata'
import { detectCountry, parsePhone } from './phone'

let max: PhoneMetadata
beforeAll(async () => {
	max = await loadMetadata('max')
})

describe('phoneSeed', () => {
	it.each([
		{ callingCode: '49', country: 'DE', national: '1511 2345678', number: '+4915112345678' },
		{ callingCode: '41', country: 'CH', national: '44 668 18 00', number: '+41446681800' },
		{ callingCode: '1', country: 'US', national: '212 555 2368', number: '+12125552368' },
	] as const)('splits $number the way the admin row lays it out', (expected) => {
		expect(phoneSeed(expected.number, { metadata: max })).toEqual(expected)
	})

	it('carries the raw input back, so a caller can tell which number it describes', () => {
		expect(phoneSeed('0151 12345678', { defaultCountry: 'DE', metadata: max })?.number).toBe(
			'0151 12345678'
		)
	})

	it.each(['abc', ''])('returns null for input the engine cannot parse: %s', (raw) => {
		expect(phoneSeed(raw, { metadata: max })).toBeNull()
	})
})

describe('callingCodeOf', () => {
	it.each([
		['+41', '41'],
		['+4144', '41'],
		['+1', '1'],
		['+44', '44'],
	])('reads %s as +%s', (input, expected) => {
		expect(callingCodeOf(input, { metadata: max })).toBe(expected)
	})

	it.each([
		'+',
		'+4',
		'+9',
		'+999',
		'',
		'0151 12345678',
	])('identifies no calling code in %s', (input) => {
		expect(callingCodeOf(input, { metadata: max })).toBeUndefined()
	})
})

describe('provisionalCountry', () => {
	// The first country a shared calling code lists is the one it stands for
	it.each([
		['+41', 'CH'],
		['+4144', 'CH'],
		['+41446681800', 'CH'],
		['+1', 'US'],
		['+1604', 'US'],
		['+16045551234', 'CA'],
		['+7', 'RU'],
		['+77', 'KZ'],
		['+79', 'RU'],
		['+44', 'GB'],
		['+4477', 'GB'],
	])('reads %s as %s', (input, expected) => {
		expect(provisionalCountry(input, { metadata: max })).toBe(expected)
	})

	it.each([
		'+',
		'+4',
		'+9',
		'+999',
		'',
		'0151 12345678',
		'not a number',
	])('names no country for %s, so junk still fabricates none', (input) => {
		expect(provisionalCountry(input, { metadata: max })).toBeUndefined()
	})

	// detectCountry answers only for a complete valid number, which is the whole gap this fills
	it('answers where the validated read cannot', () => {
		expect(detectCountry('+41', { metadata: max })).toBeUndefined()
		expect(provisionalCountry('+41', { metadata: max })).toBe('CH')
	})
})

describe('isPhoneInput', () => {
	it.each([
		'',
		'+49 151 1234-5678',
		'(030) 123.456/78',
		'+1 (212) 555-2368',
	])('accepts %s', (input) => {
		expect(isPhoneInput(input)).toBe(true)
	})

	it.each([
		'0151 x123',
		'tel:+4915112345678',
		'not a number',
		'+49 151 1234 5678 ext. 9',
	])('rejects %s', (input) => {
		expect(isPhoneInput(input)).toBe(false)
	})
})

describe('digitCount', () => {
	it('counts digits rather than characters, so formatting spends no budget', () => {
		expect(digitCount('+49 (151) 1234-5678')).toBe(13)
		expect(digitCount(' ()./-+')).toBe(0)
	})
})

describe('exceedsPhoneLength', () => {
	it('stays false for an empty draft and for a complete number', () => {
		expect(exceedsPhoneLength('', { metadata: max })).toBe(false)
		expect(exceedsPhoneLength('+41 44 668 18 00', { metadata: max })).toBe(false)
		expect(
			exceedsPhoneLength('1511 2345678', { callingCode: '49', defaultCountry: 'DE', metadata: max })
		).toBe(false)
	})

	it('uses the country ceiling where the metadata defines one', () => {
		expect(
			exceedsPhoneLength('2025550123', { callingCode: '1', defaultCountry: 'US', metadata: max })
		).toBe(false)
		expect(
			exceedsPhoneLength('20255501239', { callingCode: '1', defaultCountry: 'US', metadata: max })
		).toBe(true)
		expect(exceedsPhoneLength('+120255501239', { metadata: max })).toBe(true)
	})

	// Germany's metadata carries no upper bound at all, so only the E.164 ceiling stops it
	it('falls back to E.164 for a country with no ceiling of its own', () => {
		const atCeiling = '1511234567890'
		expect(digitCount(atCeiling)).toBe(13)
		const opts = { callingCode: '49', defaultCountry: 'DE', metadata: max } as const
		expect(exceedsPhoneLength(atCeiling, opts)).toBe(false)
		expect(exceedsPhoneLength(`${atCeiling}1`, opts)).toBe(true)
		expect(exceedsPhoneLength('+49 1511 234 567 890 1', { metadata: max })).toBe(true)
	})

	// The calling code shown beside a national draft is part of the same 15-digit budget
	it('charges a national draft for the calling code it is entered under', () => {
		const thirteen = '1234567890123'
		expect(exceedsPhoneLength(thirteen, { callingCode: '998', metadata: max })).toBe(true)
		expect(exceedsPhoneLength(thirteen, { metadata: max })).toBe(false)
	})

	it('spends the budget on digits, not on the separators between them', () => {
		const opts = { callingCode: '49', defaultCountry: 'DE', metadata: max } as const
		expect(exceedsPhoneLength('1-5-1-1-2-3-4-5-6-7-8-9-0', opts)).toBe(false)
		expect(exceedsPhoneLength('1-5-1-1-2-3-4-5-6-7-8-9-0-1', opts)).toBe(true)
	})

	// A half-typed number of a country whose possible lengths have a gap reads INVALID_LENGTH
	it('lets a draft through a gap in a country possible lengths', () => {
		expect(
			exceedsPhoneLength('44 668 18 000', {
				callingCode: '41',
				defaultCountry: 'CH',
				metadata: max,
			})
		).toBe(false)
	})
})

describe('nationalPart', () => {
	it('falls back to the national format when the international one carries no calling code', () => {
		const parsed = parsePhone('+4915112345678', { metadata: max })
		if (!parsed) throw new Error('expected a parsed number')
		expect(nationalPart({ ...parsed, international: 'no plus here' })).toBe(parsed.national)
	})
})
