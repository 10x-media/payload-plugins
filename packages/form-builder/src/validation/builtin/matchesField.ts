import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

export const matchesFieldRule = defineValidationRule<{ field: string }, unknown>({
	type: 'matchesField',
	label: keys.ruleMatchesField,
	params: [{ name: 'field', type: 'text', required: true, label: keys.ruleParamField }],
	defaultMessage: keys.ruleMatchesFieldMessage,
	validate: ({ value, params, siblingData, message }) =>
		value === siblingData[params.field] ? true : message(),
})
