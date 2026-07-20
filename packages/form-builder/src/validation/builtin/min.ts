import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

export const minRule = defineValidationRule<{ min: number }, number>({
	type: 'min',
	label: keys.ruleMin,
	description: keys.ruleMinDescription,
	appliesTo: ['number'],
	params: [{ name: 'min', type: 'number', required: true, label: labelFor(keys.ruleParamMin) }],
	defaultMessage: keys.ruleMinMessage,
	validate: ({ value, params, message }) =>
		value == null || value >= params.min ? true : message({ min: params.min }),
})
