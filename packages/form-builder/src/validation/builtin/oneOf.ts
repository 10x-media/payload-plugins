import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

export const oneOfRule = defineValidationRule<{ values?: { value: string }[] }, string>({
	type: 'oneOf',
	label: keys.ruleOneOf,
	appliesTo: ['text', 'textarea', 'select'],
	params: [
		{
			name: 'values',
			type: 'array',
			label: labelFor(keys.ruleParamValues),
			fields: [{ name: 'value', type: 'text', required: true }],
		},
	],
	defaultMessage: keys.ruleOneOfMessage,
	validate: ({ value, params, message }) => {
		if (value == null || value === '') {
			return true
		}
		const allowed = (params.values ?? []).map((entry) => entry.value)
		if (allowed.length === 0) {
			return true
		}
		return allowed.includes(value) ? true : message()
	},
})
