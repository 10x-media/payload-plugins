import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

const tryRegExp = (pattern: string, flags?: string): RegExp | undefined => {
	try {
		return new RegExp(pattern, flags)
	} catch {
		return undefined
	}
}

export const patternRule = defineValidationRule<{ pattern: string; flags?: string }, string>({
	type: 'pattern',
	label: keys.rulePattern,
	appliesTo: ['text', 'textarea', 'email'],
	params: [
		{ name: 'pattern', type: 'text', required: true, label: labelFor(keys.ruleParamPattern) },
		{ name: 'flags', type: 'text', label: labelFor(keys.ruleParamFlags) },
	],
	defaultMessage: keys.rulePatternMessage,
	validate: ({ value, params, message }) => {
		if (value == null || value === '') {
			return true
		}
		const regex = tryRegExp(params.pattern, params.flags)
		if (!regex) {
			return true
		}
		return regex.test(value) ? true : message()
	},
})
