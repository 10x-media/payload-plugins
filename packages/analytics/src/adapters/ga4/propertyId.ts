import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/**
 * A GA4 property as the Data API takes it: the number alone. `properties/<id>` saves fine but every
 * read answers "3 INVALID_ARGUMENT: ... A numeric Property ID is required".
 */
const PROPERTY_ID_PATTERN = /^\d+$/

/** Empty is allowed: the field is optional. */
export const validatePropertyId: TextFieldSingleValidation = (value, { req }) => {
	const id = value?.trim()
	return !id || PROPERTY_ID_PATTERN.test(id)
		? true
		: asTranslate(req.t)(keys.providerErrorPropertyId)
}
