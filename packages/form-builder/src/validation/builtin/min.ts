import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

export const minRule = defineValidationRule<{ min: number }, number>({
	type: 'min',
	label: keys.ruleMin,
	appliesTo: ['number'],
	params: [{ name: 'min', type: 'number', required: true, label: keys.ruleParamMin }],
	defaultMessage: keys.ruleMinMessage,
	validate: ({ value, params, message }) =>
		value == null || value >= params.min ? true : message({ min: params.min }),
})
