import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

const FORM_SUBMISSIONS_SLUG = 'form-submissions'
const SCAN_LIMIT = 500

/**
 * Server-only async exemplar: rejects a value already present for the same form. Scans up to
 * `SCAN_LIMIT` recent submissions in JS (the values live in a json column, so a portable DB query is
 * not available); a future phase can add an indexed dedup column for scale.
 */
export const notAlreadySubmittedRule = defineValidationRule<Record<string, never>, unknown>({
	type: 'notAlreadySubmitted',
	label: keys.ruleNotAlreadySubmitted,
	description: keys.ruleNotAlreadySubmittedDescription,
	client: false,
	defaultMessage: keys.ruleNotAlreadySubmittedMessage,
	validate: async ({ value, field, payload, req, formId, message }) => {
		if (value == null || value === '' || !payload || formId == null) {
			return true
		}
		const result = await payload.find({
			collection: FORM_SUBMISSIONS_SLUG,
			where: { form: { equals: formId } },
			limit: SCAN_LIMIT,
			depth: 0,
			req,
		})
		const clash = result.docs.some((doc) => {
			const values = (doc as { values?: { field: string; value: unknown }[] }).values ?? []
			return values.some((entry) => entry.field === field.name && entry.value === value)
		})
		return clash ? message() : true
	},
})
