import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'

type CreateSipgateDevicesCollectionOptions = {
	slug: string
	sipgateUsersSlug: string
	overrides?: Partial<CollectionConfig>
}

export const createSipgateDevicesCollection = ({
	slug,
	sipgateUsersSlug,
	overrides,
}: CreateSipgateDevicesCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: 'Sipgate Device',
			plural: 'Sipgate Devices',
		},
		admin: {
			useAsTitle: 'alias',
			defaultColumns: ['alias', 'id', 'type', 'online', 'dnd'],
			components: {
				listMenuItems: ['@10x-media/sipgate/ui/SipgateSyncButton#SipgateDevicesSyncButton'],
			},
		},
		fields: [
			{
				name: 'id',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: 'Sipgate device ID (e.g. e0)' },
			},
			{
				name: 'alias',
				type: 'text',
			},
			{
				type: 'row',
				fields: [
					{
						name: 'sipgateUserId',
						type: 'text',
						admin: {
							description: 'Sipgate user ID (e.g. w0)',
							readOnly: true,
						},
					},
					{
						name: 'sipgateUser',
						type: 'relationship',
						relationTo: sipgateUsersSlug as 'users',
						admin: {
							description: 'Sipgate user',
							readOnly: true,
						},
					},
				],
			},
			{
				name: 'type',
				type: 'select',
				options: [
					{ label: 'Register', value: 'REGISTER' },
					{ label: 'Mobile', value: 'MOBILE' },
					{ label: 'External', value: 'EXTERNAL' },
					{ label: 'WebRTC', value: 'WEBRTC' },
					{ label: 'CLINQ', value: 'CLINQ' },
				],
			},
			{
				type: 'row',
				fields: [
					{
						name: 'online',
						type: 'checkbox',
						defaultValue: false,
					},
					{
						name: 'dnd',
						label: 'Do Not Disturb',
						type: 'checkbox',
						defaultValue: false,
					},
				],
			},
			{
				name: 'activeGroups',
				type: 'array',
				admin: { description: 'Channel groups this device is currently active in' },
				fields: [
					{ name: 'id', type: 'text' },
					{ name: 'alias', type: 'text' },
				],
			},
			{
				name: 'activePhonelines',
				type: 'array',
				admin: { description: 'Phonelines this device is currently active on' },
				fields: [
					{ name: 'id', type: 'text' },
					{ name: 'alias', type: 'text' },
				],
			},
		],
	}

	if (overrides) {
		return deepMerge(defaults, overrides)
	}

	return defaults
}
