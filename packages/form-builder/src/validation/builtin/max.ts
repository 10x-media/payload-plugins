import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

export const maxRule = defineValidationRule<{ max: number }, number>({
	type: 'max',
	label: keys.ruleMax,
	appliesTo: ['number'],
	params: [{ name: 'max', type: 'number', required: true, label: keys.ruleParamMax }],
	defaultMessage: keys.ruleMaxMessage,
	validate: ({ value, params, message }) =>
		value == null || value <= params.max ? true : message({ max: params.max }),
})
