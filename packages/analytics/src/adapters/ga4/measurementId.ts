import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/** What Google's own ids look like, and all the inline snippet and the tag URL may carry. */
export const MEASUREMENT_ID_PATTERN = /^[A-Za-z0-9-]+$/

/**
 * Validates the id as the adapter admits it, without loading the adapter's `@google-analytics/data`
 * peer. Empty passes: the id is optional and only turns capture on.
 */
export const validateMeasurementId: TextFieldSingleValidation = (value, { req }) =>
	!value || MEASUREMENT_ID_PATTERN.test(value)
		? true
		: asTranslate(req.t)(keys.providerErrorMeasurementId)
