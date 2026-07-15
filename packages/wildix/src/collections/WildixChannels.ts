import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

type CreateWildixChannelsCollectionOptions = {
	slug: string
	wildixUsersSlug: string
	overrides?: Partial<CollectionConfig>
}

export const createWildixChannelsCollection = ({
	slug,
	wildixUsersSlug,
	overrides,
}: CreateWildixChannelsCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: labelForKey(keys.wildixChannelsSingular),
			plural: labelForKey(keys.wildixChannelsPlural),
		},
		admin: {
			useAsTitle: 'name',
			defaultColumns: ['name', 'wildixId'],
			components: {
				listMenuItems: ['@10x-media/wildix/ui/WildixSyncButton#WildixChannelsSyncButton'],
			},
		},
		fields: [
			{
				name: 'wildixId',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: labelForKey(keys.wildixChannelsDescChannelId) },
			},
			{ name: 'name', type: 'text' },
			{
				name: 'assignedUsers',
				type: 'array',
				admin: { description: labelForKey(keys.wildixChannelsDescAssignedUsers) },
				fields: [
					{ name: 'extension', type: 'text' },
					{
						name: 'user',
						type: 'relationship',
						relationTo: wildixUsersSlug as 'users',
						required: false,
					},
				],
			},
			{
				name: 'settings',
				type: 'group',
				fields: [
					{ name: 'strategy', type: 'text' },
					{ name: 'cid', type: 'text' },
					{ name: 'queueManager', type: 'text' },
					{
						type: 'row',
						fields: [
							{ name: 'timeout', type: 'number' },
							{ name: 'maxLen', type: 'number' },
							{ name: 'wrapUpTime', type: 'number' },
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
