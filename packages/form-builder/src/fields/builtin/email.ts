import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
