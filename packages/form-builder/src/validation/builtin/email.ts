import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const emailRule = defineValidationRule<Record<string, never>, string>({
	type: 'email',
	label: keys.ruleEmail,
	appliesTo: ['text', 'textarea', 'email'],
	defaultMessage: keys.ruleEmailMessage,
	validate: ({ value, message }) =>
		value == null || value === '' || EMAIL_PATTERN.test(value) ? true : message(),
})
