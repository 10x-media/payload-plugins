import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

export const calculationField = defineFormField<'number'>({
	type: 'calculation',
	label: keys.fieldTypeCalculation,
	value: 'number',
	config: [
		{ name: 'expression', type: 'json', label: labelFor(keys.configExpression) },
		{
			name: 'calcDisplay',
			type: 'checkbox',
			defaultValue: true,
			label: labelFor(keys.configCalcDisplay),
		},
	],
	format: ({ value }) => (value == null ? '' : String(value)),
})
