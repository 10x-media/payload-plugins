import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

export const minLengthRule = defineValidationRule<{ min: number }, string>({
	type: 'minLength',
	label: keys.ruleMinLength,
	description: keys.ruleMinLengthDescription,
	appliesTo: ['text', 'textarea', 'email'],
	params: [
		{ name: 'min', type: 'number', required: true, min: 0, label: labelFor(keys.ruleParamMin) },
	],
	defaultMessage: keys.ruleMinLengthMessage,
	validate: ({ value, params, message }) =>
		value == null || value === '' || value.length >= params.min
			? true
			: message({ min: params.min }),
})
