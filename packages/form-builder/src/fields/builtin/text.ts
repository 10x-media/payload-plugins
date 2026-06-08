import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

export const textField = defineFormField<'text'>({
	type: 'text',
	label: keys.fieldTypeText,
	value: 'text',
	format: ({ value }) => (value == null ? '' : String(value)),
})
