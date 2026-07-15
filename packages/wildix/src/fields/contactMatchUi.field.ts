import { deepMerge, type Field } from 'payload'

export const createContactMatchUiField = (
	phoneNumberFields: string[],
	overrides?: Partial<Field>
) => {
	const defaultField: Field = {
		name: 'contactMatchUi',
		type: 'ui',
		label: 'Contact Match UI',
		admin: {
			position: 'sidebar',
			components: {
				Field: {
					path: '@10x-media/wildix/ui/ContactMatchUiField',
					clientProps: { phoneNumberFields },
				},
			},
		},
	}
	return deepMerge<Field>(defaultField, overrides ?? {})
}
