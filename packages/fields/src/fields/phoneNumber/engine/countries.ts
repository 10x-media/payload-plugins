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
 * A property of the country itself, so it holds for a stored country the field's `countries`
 * allowlist does not offer. Undefined rather than a throw for one this set does not carry.
 */
export const callingCodeFor = (code: CountryCode, metadata: PhoneMetadata): string | undefined => {
	try {
		return getCountryCallingCode(code, metadata as never)
	} catch {
		return undefined
	}
}

/**
 * Every code libphonenumber-js ships, identical across all three metadata sets (pinned
 * against the real 'max' set below). Unlike `isSupported`, this needs no metadata, so
 * synchronous config-time guards can use it without awaiting `loadMetadata`.
 */
export const KNOWN_COUNTRY_CODES: ReadonlySet<string> = new Set(
	(
		'AC AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
		'BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC ' +
		'EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK ' +
		'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB ' +
		'LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY ' +
		'MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS ' +
		'RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TG TH TJ TK TL ' +
		'TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
	).split(' ')
)

export const isKnownCountry = (code: string): boolean => KNOWN_COUNTRY_CODES.has(code)

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
