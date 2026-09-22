import { AsYouType, type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/core'
import type { PhoneMetadata } from './metadata'

export type { CountryCode }
export type PhoneFormat = 'e164' | 'international' | 'national'
export type PhoneValidationMode = 'mobile' | 'possible' | 'valid'
export type PhoneCheck = 'empty' | 'invalid' | 'notMobile' | 'ok'

export type ParsedPhone = {
	callingCode: string
	country: CountryCode | undefined
	e164: string
	ext: string | undefined
	international: string
	national: string
	possible: boolean
	type: string | undefined
	uri: string
	valid: boolean
}

export type PhoneOptions = { defaultCountry?: CountryCode; metadata: PhoneMetadata }

const MOBILE_TYPES = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE'])

export const parsePhone = (input: string, opts: PhoneOptions): null | ParsedPhone => {
	if (input === '') return null
	const parsed = parsePhoneNumberFromString(
		input,
		{ defaultCountry: opts.defaultCountry },
		opts.metadata as never
	)
	if (!parsed) return null
	return {
		callingCode: parsed.countryCallingCode,
		country: parsed.country,
		e164: parsed.number,
		ext: parsed.ext,
		international: parsed.formatInternational(),
		national: parsed.formatNational(),
		possible: parsed.isPossible(),
		type: parsed.getType(),
		uri: parsed.getURI(),
		valid: parsed.isValid(),
	}
}

/** The number without its calling code, so it reads as one phrase beside the prefix. */
export const nationalPart = (parsed: ParsedPhone): string => {
	const prefix = `+${parsed.callingCode}`
	return parsed.international.startsWith(prefix)
		? parsed.international.slice(prefix.length).trimStart()
		: parsed.national
}

/** What the admin row shows for a stored number, split the way the row lays it out. */
export type PhoneSeed = {
	callingCode: string
	country: CountryCode | undefined
	national: string
	number: string
}

/**
 * Derived wherever metadata is already free (the server), so the first client frame can
 * match the frame the engine paints once the lazy metadata import resolves.
 */
export const phoneSeed = (raw: string, opts: PhoneOptions): null | PhoneSeed => {
	const parsed = parsePhone(raw, opts)
	if (!parsed) return null
	return {
		callingCode: parsed.callingCode,
		country: parsed.country,
		national: nationalPart(parsed),
		number: raw,
	}
}

export const formatPhone = (input: string, format: PhoneFormat, opts: PhoneOptions): string => {
	const parsed = parsePhone(input, opts)
	if (!parsed) return input
	if (format === 'e164') return parsed.e164
	return format === 'national' ? parsed.national : parsed.international
}

export const phoneUri = (input: string, opts: PhoneOptions): null | string =>
	parsePhone(input, opts)?.uri ?? null

/**
 * The longest leading candidate that parses to a valid, country-bearing number, so a
 * doubled paste or one wrapped in punctuation cannot fabricate a number by stripping
 * characters out of it.
 */
export const salvagePhone = (input: string, opts: PhoneOptions): null | ParsedPhone => {
	const trimmed = input.trim()
	const direct = parsePhone(trimmed, opts)
	if (direct?.valid && direct.country) return direct
	const plus = trimmed.indexOf('+')
	if (plus === -1) return null
	const tail = trimmed.slice(plus)
	// E.164 numbers max out at 15 digits; 18 bounds the scan without truncating a real one.
	for (let end = Math.min(tail.length, 18); end > 2; end--) {
		const candidate = parsePhone(tail.slice(0, end), opts)
		if (candidate?.valid && candidate.country) return candidate
	}
	return null
}

export const detectCountry = (input: string, opts: PhoneOptions): CountryCode | undefined =>
	salvagePhone(input, opts)?.country

export const checkPhone = (
	input: string,
	mode: PhoneValidationMode,
	opts: PhoneOptions
): PhoneCheck => {
	if (input.trim() === '') return 'empty'
	const parsed = parsePhone(input, opts)
	if (!parsed) return 'invalid'
	if (mode === 'possible') return parsed.possible ? 'ok' : 'invalid'
	if (!parsed.valid) return 'invalid'
	if (mode === 'mobile') {
		return parsed.type !== undefined && MOBILE_TYPES.has(parsed.type) ? 'ok' : 'notMobile'
	}
	return 'ok'
}

export const formatAsYouType = (
	input: string,
	country: CountryCode | undefined,
	opts: PhoneOptions
): string => new AsYouType(country, opts.metadata as never).input(input)
