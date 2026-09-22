import { getCountries, getCountryCallingCode, isSupportedCountry } from 'libphonenumber-js/core'
import type { PhoneMetadata } from './metadata'
import type { CountryCode } from './phone'

export type CountryOption = { callingCode: string; code: CountryCode; name: string }

const REGIONAL_INDICATOR_A = 0x1f1e6
const LATIN_A = 'A'.charCodeAt(0)

/** Regional indicator pairs are pure arithmetic over the ISO code, so no artwork is needed. */
export const emojiFlag = (code: CountryCode): string =>
	[...code.toUpperCase()]
		.map((char) => String.fromCodePoint(REGIONAL_INDICATOR_A + char.charCodeAt(0) - LATIN_A))
		.join('')

export const isSupported = (code: string, metadata: PhoneMetadata): boolean =>
	isSupportedCountry(code as CountryCode, metadata as never)

/**
 * Intl.DisplayNames covers every admin locale natively, so no translation keys are needed.
 * Only a malformed tag throws; a well-formed but unrecognized one resolves to a default.
 */
const displayNames = (locale: string): Intl.DisplayNames | null => {
	try {
		return new Intl.DisplayNames([locale], { type: 'region' })
	} catch {
		return null
	}
}

export const countryOptions = (opts: {
	countries?: readonly CountryCode[]
	locale: string
	metadata: PhoneMetadata
	preferredCountries?: readonly CountryCode[]
}): { preferred: CountryOption[]; rest: CountryOption[] } => {
	const names = displayNames(opts.locale)
	const available = new Set(getCountries(opts.metadata as never))
	const selected = (opts.countries ?? [...available]).filter((code) => available.has(code))

	const toOption = (code: CountryCode): CountryOption => ({
		callingCode: getCountryCallingCode(code, opts.metadata as never),
		code,
		name: names?.of(code) ?? code,
	})

	const preferredCodes = (opts.preferredCountries ?? []).filter((code) => selected.includes(code))
	const preferredSet = new Set(preferredCodes)

	return {
		preferred: preferredCodes.map(toOption),
		rest: selected
			.filter((code) => !preferredSet.has(code))
			.map(toOption)
			.sort((a, b) => a.name.localeCompare(b.name, opts.locale)),
	}
}
