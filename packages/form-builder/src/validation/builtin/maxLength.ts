import { keys } from '../../translations/keys'
import { defineValidationRule } from '../defineValidationRule'

export const maxLengthRule = defineValidationRule<{ max: number }, string>({
	type: 'maxLength',
	label: keys.ruleMaxLength,
	appliesTo: ['text', 'textarea', 'email'],
	params: [{ name: 'max', type: 'number', required: true, min: 0, label: keys.ruleParamMax }],
	defaultMessage: keys.ruleMaxLengthMessage,
	validate: ({ value, params, message }) =>
		value == null || value === '' || value.length <= params.max
			? true
			: message({ max: params.max }),
})
