import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

export const checkboxField = defineFormField<'boolean'>({
	type: 'checkbox',
	label: keys.fieldTypeCheckbox,
	value: 'boolean',
	format: ({ value, t }) => (value ? t(keys.formatYes) : t(keys.formatNo)),
})
