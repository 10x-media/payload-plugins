import { deepMerge, type Field } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const defaultField: Field = {
	name: 'phoneNumber',
	type: 'text',
	label: labelForKey(keys.fieldPhoneNumber),
	admin: {
		components: {
			Field: '@10x-media/sipgate/ui/ClickToDialField',
		},
	},
}

export const createPhoneNumberField = (overrides?: Partial<Field>) =>
	deepMerge<Field>(defaultField, overrides ?? {})
