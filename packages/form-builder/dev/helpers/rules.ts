import {
	type AnyValidationRuleDefinition,
	defineValidationRule,
	type ValidationRuleOption,
} from '../../src/index'

export const dateMinRule = defineValidationRule<{ min: string }, string>({
	type: 'dateMin',
	label: 'Minimum date',
	appliesTo: ['date'],
	defaultMessage: 'Date must be on or after {min}',
	params: [{ name: 'min', type: 'text', required: true, label: 'Minimum (YYYY-MM-DD)' }],
	validate: ({ value, params, message }) => {
		if (value == null || value === '') return true
		return Date.parse(String(value)) >= Date.parse(params.min) ? true : message({ min: params.min })
	},
}) as ValidationRuleOption

export const dateMaxRule = defineValidationRule<{ max: string }, string>({
	type: 'dateMax',
	label: 'Maximum date',
	appliesTo: ['date'],
	defaultMessage: 'Date must be on or before {max}',
	params: [{ name: 'max', type: 'text', required: true, label: 'Maximum (YYYY-MM-DD)' }],
	validate: ({ value, params, message }) => {
		if (value == null || value === '') return true
		return Date.parse(String(value)) <= Date.parse(params.max) ? true : message({ max: params.max })
	},
}) as ValidationRuleOption

export const customRules = [dateMinRule, dateMaxRule] as AnyValidationRuleDefinition[]
