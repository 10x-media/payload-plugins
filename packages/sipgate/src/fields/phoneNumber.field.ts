import { deepMerge, type Field } from 'payload'

const defaultField: Field = {
	name: 'phoneNumber',
	type: 'text',
	label: 'Phone Number',
	admin: {
		components: {
			Field: '@10x-media/sipgate/ui/ClickToDialField',
		},
	},
}

export const createPhoneNumberField = (overrides?: Partial<Field>) =>
	deepMerge<Field>(defaultField, overrides ?? {})
