import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

/** ISO 4217: three uppercase letters. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/

/**
 * Shared by the goals collection and the form-builder goal action so a currency authored in
 * either place is accepted on the same terms. Empty is allowed: the currency is optional.
 */
export const validateCurrency: TextFieldSingleValidation = (value, { req }) =>
	!value || CURRENCY_PATTERN.test(value) ? true : asTranslate(req.t)(keys.goalErrorCurrency)
