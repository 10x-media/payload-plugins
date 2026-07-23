import { keys } from '../../translations/keys'
import { EMAIL_PATTERN } from '../../validation/emailPattern'
import { defineFormField } from '../defineFormField'

export const emailField = defineFormField<'text'>({
	type: 'email',
	label: keys.fieldTypeEmail,
	value: 'text',
	validate: ({ value, t }) => {
		if (value == null || value === '') {
			return true
		}
		return EMAIL_PATTERN.test(value) ? true : t(keys.validationEmail)
	},
	format: ({ value }) => (value == null ? '' : String(value)),
})
