import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

export const numberField = defineFormField<'number'>({
	type: 'number',
	label: keys.fieldTypeNumber,
	value: 'number',
	validate: ({ value, t }) => {
		if (value == null) {
			return true
		}
		return Number.isFinite(value) ? true : t(keys.validationNumber)
	},
	format: ({ value }) => (value == null ? '' : String(value)),
})
