import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'
import { fieldTargetParam } from '../fieldTargetParam'

export const matchesFieldRule = defineValidationRule<{ field: string }, unknown>({
	type: 'matchesField',
	label: keys.ruleMatchesField,
	description: keys.ruleMatchesFieldDescription,
	params: [fieldTargetParam('field')],
	defaultMessage: keys.ruleMatchesFieldMessage,
	validate: ({ value, params, siblingData, message }) =>
		value === siblingData[params.field] ? true : message(),
})
