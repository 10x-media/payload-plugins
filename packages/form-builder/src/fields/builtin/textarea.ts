import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

export const textareaField = defineFormField<'text'>({
	type: 'textarea',
	label: keys.fieldTypeTextarea,
	value: 'text',
	format: ({ value }) => (value == null ? '' : String(value)),
})
