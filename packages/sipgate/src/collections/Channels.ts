import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'

type CreateSipgateChannelsCollectionOptions = {
	slug: string
	sipgateUsersSlug: string
	overrides?: Partial<CollectionConfig>
}

export const createSipgateChannelsCollection = ({
	slug,
	sipgateUsersSlug,
	overrides,
}: CreateSipgateChannelsCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: 'Sipgate Channel',
			plural: 'Sipgate Channels',
		},
		admin: {
			useAsTitle: 'name',
			defaultColumns: ['name', 'id', 'owner', 'createdAt'],
			components: {
				listMenuItems: ['@10x-media/sipgate/ui/SipgateSyncButton#SipgateChannelsSyncButton'],
			},
		},
		fields: [
			{
				name: 'id',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: 'Sipgate channel ID' },
			},
			{
				name: 'name',
				type: 'text',
			},
			{
				name: 'owner',
				type: 'text',
				admin: { description: 'Sipgate user ID of the channel owner (e.g. w0)' },
			},
			{
				name: 'locale',
				type: 'text',
			},
			{
				name: 'createdAt',
				type: 'date',
			},
			{
				name: 'assignedUsers',
				type: 'array',
				admin: {
					description: 'Users assigned to this channel and their active device IDs',
				},
				fields: [
					{
						name: 'user',
						type: 'relationship',
						relationTo: sipgateUsersSlug as 'users',
						required: false,
						admin: { description: 'Resolved sipgate user (populated on sync)' },
					},
					{
						name: 'sipgateUserId',
						type: 'text',
						admin: {
							description:
								'Raw sipgate user ID (e.g. w0) - used to resolve the relationship on sync',
						},
					},
					{
						name: 'deviceIds',
						type: 'array',
						fields: [
							{
								name: 'deviceId',
								type: 'text',
							},
						],
					},
				],
			},
			{
				name: 'settings',
				type: 'group',
				fields: [
					{
						name: 'greetingAudioFileId',
						type: 'text',
					},
					{
						name: 'smsSim',
						type: 'text',
					},
					{
						name: 'voiceboxAccessNumber',
						type: 'number',
					},
					{
						name: 'queue',
						type: 'group',
						fields: [
							{
								name: 'respectWaitingTime',
								type: 'checkbox',
								defaultValue: false,
							},
							{
								name: 'waitingAudioFileId',
								type: 'text',
							},
						],
					},
					{
						name: 'ringingOrder',
						type: 'group',
						fields: [
							{
								name: 'type',
								type: 'text',
							},
							{
								name: 'users',
								type: 'array',
								fields: [
									{
										name: 'userId',
										type: 'text',
									},
								],
							},
						],
					},
					{
						name: 'userDefaults',
						label: 'User Defaults',
						type: 'group',
						fields: [
							{
								name: 'followUpTime',
								type: 'number',
							},
							{
								name: 'ringTime',
								type: 'number',
							},
						],
					},
				],
			},
		],
	}

	if (overrides) {
		return deepMerge(defaults, overrides)
	}

	return defaults
}
