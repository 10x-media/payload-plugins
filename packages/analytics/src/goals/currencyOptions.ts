import { collator, displayNames } from '../translations/intl'

/** ISO 4217 codes the currency picker offers: the ones most websites sell in. */
export const CURRENCY_CODES: readonly string[] = [
	'AED',
	'AUD',
	'BRL',
	'CAD',
	'CHF',
	'CNY',
	'CZK',
	'DKK',
	'EGP',
	'EUR',
	'GBP',
	'HKD',
	'HUF',
	'IDR',
	'ILS',
	'INR',
	'JPY',
	'KRW',
	'MXN',
	'MYR',
	'NOK',
	'NZD',
	'PLN',
	'RON',
	'RUB',
	'SAR',
	'SEK',
	'SGD',
	'THB',
	'TRY',
	'UAH',
	'USD',
	'ZAR',
]

export interface CurrencyOption {
	label: string
	value: string
}

const currencyNames = (locale: string): Intl.DisplayNames | undefined =>
	displayNames(locale, { type: 'currency' }) ?? undefined

/** `Intl.DisplayNames` throws for a stored value that is no code at all; it has no name. */
const nameOf = (code: string, names: Intl.DisplayNames | undefined): string | undefined => {
	try {
		return names?.of(code)
	} catch {
		return undefined
	}
}

/** The currency's name and its code, "Euro (EUR)"; just the code where no name is known. */
const labelOf = (code: string, names: Intl.DisplayNames | undefined): string => {
	const name = nameOf(code, names)
	return name && name !== code ? `${name} (${code})` : code
}

/**
 * The picker's options in the admin's language, sorted by name. Codes in `include` are always
 * offered, so a value saved outside the list still shows as picked.
 */
export const currencyOptions = (
	locale: string,
	include: ReadonlyArray<string | undefined> = []
): CurrencyOption[] => {
	const names = currencyNames(locale)
	const codes = new Set(CURRENCY_CODES)
	for (const code of include) {
		if (code) {
			codes.add(code)
		}
	}
	const { compare } = collator(locale)
	return [...codes]
		.map((code) => ({ label: labelOf(code, names), value: code }))
		.sort((a, b) => compare(a.label, b.label))
}
