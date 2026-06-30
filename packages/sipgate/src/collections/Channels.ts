import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

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
			singular: labelForKey(keys.sipgateChannelsSingular),
			plural: labelForKey(keys.sipgateChannelsPlural),
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
				admin: { description: labelForKey(keys.sipgateChannelsDescChannelId) },
			},
			{
				name: 'name',
				type: 'text',
			},
			{
				name: 'owner',
				type: 'text',
				admin: { description: labelForKey(keys.sipgateChannelsDescOwner) },
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
					description: labelForKey(keys.sipgateChannelsDescAssignedUsers),
				},
				fields: [
					{
						name: 'user',
						type: 'relationship',
						relationTo: sipgateUsersSlug as 'users',
						required: false,
						admin: { description: labelForKey(keys.sipgateChannelsDescAssignedUsersUser) },
					},
					{
						name: 'sipgateUserId',
						type: 'text',
						admin: {
							description: labelForKey(keys.sipgateChannelsDescAssignedUsersSipgateUserId),
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
						label: labelForKey(keys.sipgateChannelsLabelUserDefaults),
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
