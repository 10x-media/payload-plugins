import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

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
			singular: labelForKey(keys.sipgateDevicesSingular),
			plural: labelForKey(keys.sipgateDevicesPlural),
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
				name: 'sipgateId',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: labelForKey(keys.sipgateDevicesDescDeviceId) },
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
							description: labelForKey(keys.sipgateDevicesDescSipgateUserId),
							readOnly: true,
						},
					},
					{
						name: 'sipgateUser',
						type: 'relationship',
						relationTo: sipgateUsersSlug as 'users',
						admin: {
							description: labelForKey(keys.sipgateDevicesDescSipgateUser),
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
						label: labelForKey(keys.sipgateDevicesLabelDnd),
						type: 'checkbox',
						defaultValue: false,
					},
				],
			},
			{
				name: 'activeGroups',
				type: 'array',
				admin: { description: labelForKey(keys.sipgateDevicesDescActiveGroups) },
				fields: [
					{ name: 'id', type: 'text' },
					{ name: 'alias', type: 'text' },
				],
			},
			{
				name: 'activePhonelines',
				type: 'array',
				admin: { description: labelForKey(keys.sipgateDevicesDescActivePhonelines) },
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
