import type { TextField, TextFieldSingleValidation } from 'payload'
import type { AnalyticsFilter, DimensionKey } from '../core/contract'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'

/** ISO 4217: three uppercase letters. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/

/**
 * An adapter's currency option as an upper-case ISO 4217 code, undefined when blank. Anything else
 * throws naming the option, so a typo never mislabels revenue.
 */
export const currencyOption = (option: string, value: string | undefined): string | undefined => {
	const code = value?.trim().toUpperCase()
	if (!code) {
		return undefined
	}
	if (!CURRENCY_PATTERN.test(code)) {
		throw new Error(
			`analytics: ${option} must be an ISO 4217 currency code such as "EUR", got ${JSON.stringify(value)}`
		)
	}
	return code
}

/**
 * The currency a read's revenue is in: the code an `eq` currency filter names, none under any other
 * currency filter (several may add up), else the reporting currency.
 */
export const revenueCurrencyOf = (
	filters: readonly AnalyticsFilter[] | undefined,
	reporting: string | undefined
): string | undefined => {
	const named = (filters ?? []).filter((filter) => filter.dimension === 'currency')
	const only = named.find((filter) => filter.operator === 'eq')
	if (only) {
		return CURRENCY_PATTERN.test(only.value) ? only.value : undefined
	}
	return named.length > 0 ? undefined : reporting
}

/** The currency one breakdown row's revenue is in: a `currency` row's own code, else `fallback`. */
export const rowCurrencyOf = (
	dimension: DimensionKey | null | undefined,
	value: string,
	fallback: string | undefined
): string | undefined =>
	dimension === 'currency' && CURRENCY_PATTERN.test(value) ? value : fallback

/**
 * Converts one amount into the reporting currency at ingest, at the event's own time. `undefined`
 * means no rate: the completion counts, and its amount stays out of revenue with the original kept.
 */
export type CurrencyConverter = (args: {
	amount: number
	from: string
	to: string
	at: Date
}) => number | undefined | Promise<number | undefined>

/** A three-letter code or nothing, for a currency that may stay empty. */
export const validateCurrency: TextFieldSingleValidation = (value, { req }) =>
	!value || CURRENCY_PATTERN.test(value) ? true : asTranslate(req.t)(keys.goalErrorCurrency)

/** Reads the amount a currency belongs to out of the data its validator is handed. */
export type AmountOf = (args: { data: unknown; siblingData: unknown }) => unknown

/**
 * A currency for an amount, on the same terms wherever an editor sets one: a three-letter code,
 * required once the amount is set so no amount is stored without its money.
 */
const validateCurrencyFor =
	(amountOf: AmountOf): TextFieldSingleValidation =>
	(value, { data, req, siblingData }) => {
		if (value && !CURRENCY_PATTERN.test(value)) {
			return asTranslate(req.t)(keys.goalErrorCurrency)
		}
		const amount = amountOf({ data, siblingData })
		return value || typeof amount !== 'number' || !Number.isFinite(amount)
			? true
			: asTranslate(req.t)(keys.goalErrorCurrencyRequired)
	}

/**
 * The `currency` an Amount control edits for the amount `amountOf` reads. Hidden rather than
 * disabled: Payload keeps a hidden field's value in the form and saves it.
 */
export const amountCurrencyField = (amountOf: AmountOf): TextField => ({
	name: 'currency',
	type: 'text',
	label: labelForKey(keys.goalFieldCurrency),
	validate: validateCurrencyFor(amountOf),
	admin: { hidden: true },
})
