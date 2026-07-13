import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'
import { validateDateBound } from './validateDateBound'

export const minDateRule = defineValidationRule<{ min: string }, string>({
	type: 'minDate',
	label: keys.ruleMinDate,
	appliesTo: ['date'],
	params: [
		{
			name: 'min',
			type: 'text',
			required: true,
			label: labelFor(keys.ruleParamMinDate),
			validate: validateDateBound,
		},
	],
	defaultMessage: keys.ruleMinDateMessage,
	validate: ({ value, params, message }) =>
		value == null || value === '' || value >= params.min ? true : message({ min: params.min }),
})
