import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

const isUrl = (value: string): boolean => {
	try {
		const url = new URL(value)
		return url.protocol === 'http:' || url.protocol === 'https:'
	} catch {
		return false
	}
}

export const urlRule = defineValidationRule<Record<string, never>, string>({
	type: 'url',
	label: keys.ruleUrl,
	description: keys.ruleUrlDescription,
	appliesTo: ['text', 'textarea'],
	defaultMessage: keys.ruleUrlMessage,
	validate: ({ value, message }) =>
		value == null || value === '' || isUrl(value) ? true : message(),
})
