/**
 * Admin-input plumbing over the engine: what a half-typed draft already implies, how long it
 * may still grow, and how the row splits a stored number. None of it is published through
 * `@10x-media/fields/phone/utils`, which carries the engine proper.
 */
import { AsYouType, validatePhoneNumberLength } from 'libphonenumber-js/core'
import { mainCountryForCallingCode } from './countries'
import type { PhoneMetadata } from './metadata'
import { type CountryCode, type ParsedPhone, type PhoneOptions, parsePhone } from './phone'

/** E.164 allows 15 digits after the `+`, the country calling code counted among them. */
const E164_MAX_DIGITS = 15

/** Digits, spacing and the separators real-world sources wrap a number in. */
const PHONE_INPUT_PATTERN = /^[\d\s+()./-]*$/

/** Whether a draft holds only characters a phone number can be written with. */
export const isPhoneInput = (input: string): boolean => PHONE_INPUT_PATTERN.test(input)

export const isInternational = (input: string): boolean => input.trimStart().startsWith('+')

export const digitCount = (input: string): number => (input.match(/\d/g) ?? []).length

/** A national draft spends the calling code's digits before its own. */
export type PhoneLengthOptions = PhoneOptions & { callingCode?: string }

/**
 * Whether a draft is already longer than any number it could still become. The country's own
 * ceiling decides wherever the metadata defines one, and E.164's 15 digits backstop the rest:
 * several countries, Germany among them, carry no upper bound of their own.
 */
export const exceedsPhoneLength = (input: string, opts: PhoneLengthOptions): boolean => {
	const digits = digitCount(input)
	if (digits === 0) return false
	const carried = isInternational(input) ? 0 : digitCount(opts.callingCode ?? '')
	if (digits + carried > E164_MAX_DIGITS) return true
	const length = validatePhoneNumberLength(
		input,
		{ defaultCountry: opts.defaultCountry },
		opts.metadata as never
	)
	// Only TOO_LONG: INVALID_LENGTH lands on any country whose possible lengths have a gap,
	// which a half-typed number passes through on its way to a longer valid one.
	return length === 'TOO_LONG'
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
const readTyping = (
	input: string,
	metadata: PhoneMetadata
): { callingCode: string | undefined; country: CountryCode | undefined } => {
	const typing = new AsYouType(undefined, metadata as never)
	typing.input(input)
	return { callingCode: typing.getCallingCode(), country: typing.getCountry() }
}

/** The calling code the typed digits already identify, undefined while none fits them. */
export const callingCodeOf = (input: string, opts: PhoneOptions): string | undefined =>
	readTyping(input, opts.metadata).callingCode

/**
 * The country a partial international draft already implies. Which calling code this is settles
 * on sight; which country within a shared one takes more digits, so the code's main country
 * stands in until the leading digits distinguish a specific one. Undefined for anything that
 * carries no calling code at all, so junk still names no country.
 */
export const provisionalCountry = (input: string, opts: PhoneOptions): CountryCode | undefined => {
	const { callingCode, country } = readTyping(input, opts.metadata)
	if (country !== undefined) return country
	return callingCode === undefined
		? undefined
		: mainCountryForCallingCode(callingCode, opts.metadata)
}
