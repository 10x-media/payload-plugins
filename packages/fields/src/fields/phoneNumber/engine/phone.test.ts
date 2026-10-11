import { beforeAll, describe, expect, it } from 'vitest'
import { loadMetadata, type PhoneMetadata } from './metadata'
import {
	checkPhone,
	detectCountry,
	formatAsYouType,
	formatPhone,
	parsePhone,
	phoneUri,
	salvagePhone,
} from './phone'

let max: PhoneMetadata
let min: PhoneMetadata
beforeAll(async () => {
	;[max, min] = await Promise.all([loadMetadata('max'), loadMetadata('min')])
})

describe('parsePhone', () => {
	it('parses a full international number without a default country', () => {
		const parsed = parsePhone('+4915112345678', { metadata: max })
		expect(parsed).toMatchObject({
			callingCode: '49',
			country: 'DE',
			e164: '+4915112345678',
			international: '+49 1511 2345678',
			valid: true,
		})
	})

	it('parses a national number against the default country', () => {
		expect(parsePhone('0151 12345678', { defaultCountry: 'DE', metadata: max })?.e164).toBe(
			'+4915112345678'
		)
	})

	it('returns null for input with no digits', () => {
		expect(parsePhone('not a phone', { metadata: max })).toBeNull()
	})

	it('returns null for the empty string', () => {
		expect(parsePhone('', { metadata: max })).toBeNull()
	})

	it('resolves NANP area codes to the specific country, not just US', () => {
		expect(parsePhone('+16045551234', { metadata: max })?.country).toBe('CA')
		expect(parsePhone('+12125551234', { metadata: max })?.country).toBe('US')
	})

	it('preserves an extension through E.164', () => {
		const parsed = parsePhone('+49 30 1234567 ext. 99', { metadata: max })
		expect(parsed?.ext).toBe('99')
		expect(parsed?.uri).toBe('tel:+49301234567;ext=99')
	})

	it('reports a number type on max metadata', () => {
		expect(parsePhone('+4915112345678', { metadata: max })?.type).toBe('MOBILE')
	})

	it('reports no number type on min metadata, which carries no type patterns', () => {
		expect(parsePhone('+4915112345678', { metadata: min })?.type).toBeUndefined()
	})
})

describe('formatPhone', () => {
	it.each([
		['e164', '+4915112345678'],
		['international', '+49 1511 2345678'],
		['national', '01511 2345678'],
	] as const)('formats as %s', (format, expected) => {
		expect(formatPhone('+4915112345678', format, { metadata: max })).toBe(expected)
	})

	it('returns the raw input unchanged when it cannot be parsed', () => {
		expect(formatPhone('garbage', 'national', { metadata: max })).toBe('garbage')
	})
})

describe('phoneUri', () => {
	it('builds a tel: uri', () => {
		expect(phoneUri('+4915112345678', { metadata: max })).toBe('tel:+4915112345678')
	})

	it('is null for unparseable input', () => {
		expect(phoneUri('nope', { metadata: max })).toBeNull()
	})
})

describe('detectCountry', () => {
	it('detects from a pasted international number', () => {
		expect(detectCountry('+41 44 668 1800', { metadata: max })).toBe('CH')
	})

	it('ignores surrounding whitespace and punctuation', () => {
		expect(detectCountry('  (+41) 44-668-1800  ', { metadata: max })).toBe('CH')
	})

	it('recovers the first candidate from a doubled paste', () => {
		expect(detectCountry('+41446681800+41446681800', { metadata: max })).toBe('CH')
	})

	it('is undefined for a national number with no country context', () => {
		expect(detectCountry('0151 12345678', { metadata: max })).toBeUndefined()
	})

	it('still resolves a legitimate number through the validated fast path', () => {
		expect(detectCountry('+4915112345678', { metadata: max })).toBe('DE')
	})

	it('does not guess a country from a calling code alone when nothing valid parses', () => {
		expect(detectCountry('+4915', { metadata: max })).toBeUndefined()
	})

	it('recovers the country embedded in an implausible-length number through the salvage loop', () => {
		expect(detectCountry('+491511234567800000', { metadata: max })).toBe('DE')
	})
})

describe('salvagePhone', () => {
	it('returns the whole input when it parses directly', () => {
		expect(salvagePhone('  (+41) 44-668-1800  ', { metadata: max })?.e164).toBe('+41446681800')
	})

	it('keeps the first number out of a doubled paste rather than the concatenation', () => {
		expect(salvagePhone('+41446681800+41446681800', { metadata: max })?.e164).toBe('+41446681800')
	})

	it('recovers a number buried in text that does not parse as a whole', () => {
		const parsed = salvagePhone('tel:+41446681800 tel:+41446681800', { metadata: max })
		expect(parsed).toMatchObject({ country: 'CH', e164: '+41446681800' })
	})

	it('returns null rather than a guess when nothing valid parses', () => {
		expect(salvagePhone('not a number', { metadata: max })).toBeNull()
		expect(salvagePhone('+4915', { metadata: max })).toBeNull()
	})

	// detectCountry is defined as this function's country, so a candidate without one is
	// not an answer: the scan has to keep going, exactly as it did before the two merged
	it('holds out for a candidate that carries a country', () => {
		expect(salvagePhone('+80012345678', { metadata: max })).toBeNull()
		expect(detectCountry('+80012345678', { metadata: max })).toBeUndefined()
	})

	it('answers the country detectCountry reports, since that reads this', () => {
		for (const input of ['+41 44 668 1800', '+41446681800+41446681800', '0151 12345678']) {
			expect(salvagePhone(input, { metadata: max })?.country).toBe(
				detectCountry(input, { metadata: max })
			)
		}
	})
})

describe('checkPhone', () => {
	it('treats empty input as empty, not invalid', () => {
		expect(checkPhone('', 'valid', { metadata: max })).toBe('empty')
	})

	it('accepts a valid mobile number in every mode', () => {
		for (const mode of ['possible', 'valid', 'mobile'] as const) {
			expect(checkPhone('+4915112345678', mode, { metadata: max })).toBe('ok')
		}
	})

	it('accepts a Berlin landline as valid but rejects it as mobile', () => {
		expect(checkPhone('+49301234567', 'valid', { metadata: max })).toBe('ok')
		expect(checkPhone('+49301234567', 'mobile', { metadata: max })).toBe('notMobile')
	})

	it('rejects a too-short number as invalid in valid mode', () => {
		expect(checkPhone('+4915', 'valid', { metadata: max })).toBe('invalid')
	})

	it('rejects a too-short number as invalid in possible mode', () => {
		expect(checkPhone('+4915', 'possible', { metadata: max })).toBe('invalid')
	})

	it('accepts a too-long number as possible even though it fails full validation', () => {
		expect(checkPhone('+49151123456781234', 'possible', { metadata: max })).toBe('ok')
	})

	it('rejects unparseable input in every mode', () => {
		for (const mode of ['possible', 'valid', 'mobile'] as const) {
			expect(checkPhone('abc', mode, { metadata: max })).toBe('invalid')
		}
	})
})

describe('formatAsYouType', () => {
	it.each([
		['0151', '0151'],
		['015112', '01511 2'],
		['015112345678', '01511 2345678'],
	] as const)('progressively formats %s for a selected country', (input, expected) => {
		expect(formatAsYouType(input, 'DE', { metadata: max })).toBe(expected)
	})

	it('returns the input unchanged when no country is selected and it carries no calling code', () => {
		expect(formatAsYouType('01511234', undefined, { metadata: max })).toBe('01511234')
	})
})
