import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineValidationRule } from '../defineValidationRule'

export const maxDateRule = defineValidationRule<{ max: string }, string>({
	type: 'maxDate',
	label: keys.ruleMaxDate,
	appliesTo: ['date'],
	params: [{ name: 'max', type: 'text', required: true, label: labelFor(keys.ruleParamMaxDate) }],
	defaultMessage: keys.ruleMaxDateMessage,
	validate: ({ value, params, message }) =>
		value == null || value === '' || value <= params.max ? true : message({ max: params.max }),
})
