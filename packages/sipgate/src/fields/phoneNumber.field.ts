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

type PhoneNumberFieldOptions = {
	sipgateDevicesSlug?: string
	sipgateUsersSlug?: string
	filterDevicesByUser?: boolean
}

export const createPhoneNumberField = (
	overrides?: Partial<Field>,
	options: PhoneNumberFieldOptions = {}
) => {
	const {
		sipgateDevicesSlug = 'sipgate-devices',
		sipgateUsersSlug = 'sipgate-users',
		filterDevicesByUser = true,
	} = options
	return deepMerge<Field>(
		{
			...defaultField,
			admin: {
				...defaultField.admin,
				custom: { sipgateDevicesSlug, sipgateUsersSlug, filterDevicesByUser },
			},
		},
		overrides ?? {}
	)
}
