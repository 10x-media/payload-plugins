import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

export const maxLengthRule = defineValidationRule<{ max: number }, string>({
	type: 'maxLength',
	label: keys.ruleMaxLength,
	description: keys.ruleMaxLengthDescription,
	appliesTo: ['text', 'textarea', 'email'],
	params: [
		{ name: 'max', type: 'number', required: true, min: 0, label: labelFor(keys.ruleParamMax) },
	],
	defaultMessage: keys.ruleMaxLengthMessage,
	validate: ({ value, params, message }) =>
		value == null || value === '' || value.length <= params.max
			? true
			: message({ max: params.max }),
})
