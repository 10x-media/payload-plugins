import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'
import { validateRegexFlags, validateRegexPattern } from './validateRegexParams'

const tryRegExp = (pattern: string, flags?: string): RegExp | undefined => {
	try {
		return new RegExp(pattern, flags)
	} catch {
		return undefined
	}
}

/**
 * Regex match. The params carry authoring-time `validate`s so an uncompilable pattern or flag set
 * cannot be saved; at submit time an uncompilable regex still fails open, since a stored rule that
 * predates those guards must not start rejecting every visitor's answer.
 */
export const patternRule = defineValidationRule<{ pattern: string; flags?: string }, string>({
	type: 'pattern',
	label: keys.rulePattern,
	appliesTo: ['text', 'textarea', 'email'],
	params: [
		{
			name: 'pattern',
			type: 'text',
			required: true,
			label: labelFor(keys.ruleParamPattern),
			validate: validateRegexPattern,
		},
		{
			name: 'flags',
			type: 'text',
			label: labelFor(keys.ruleParamFlags),
			validate: validateRegexFlags,
		},
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
