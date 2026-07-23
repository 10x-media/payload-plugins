import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'
import { EMAIL_PATTERN } from '../emailPattern'

export const emailRule = defineValidationRule<Record<string, never>, string>({
	type: 'email',
	label: keys.ruleEmail,
	description: keys.ruleEmailDescription,
	appliesTo: ['text', 'textarea', 'email'],
	defaultMessage: keys.ruleEmailMessage,
	validate: ({ value, message }) =>
		value == null || value === '' || EMAIL_PATTERN.test(value) ? true : message(),
})
