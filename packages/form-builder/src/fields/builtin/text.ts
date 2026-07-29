import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

export const textField = defineFormField<'text'>({
	type: 'text',
	label: keys.fieldTypeText,
	value: 'text',
	advancedConfig: [
		{
			name: 'autocomplete',
			type: 'text',
			label: labelFor(keys.configAutocomplete),
			admin: { description: labelFor(keys.configAutocompleteDescription) },
		},
	],
	format: ({ value }) => (value == null ? '' : String(value)),
})
