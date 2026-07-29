import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

export const integerRule = defineValidationRule<Record<string, never>, number>({
	type: 'integer',
	label: keys.ruleInteger,
	description: keys.ruleIntegerDescription,
	appliesTo: ['number'],
	defaultMessage: keys.ruleIntegerMessage,
	validate: ({ value, message }) => (value == null || Number.isInteger(value) ? true : message()),
})
