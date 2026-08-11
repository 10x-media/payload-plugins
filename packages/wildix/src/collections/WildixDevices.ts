import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { authenticatedCollectionAccess } from '../utils/access'

type CreateWildixDevicesCollectionOptions = {
	slug: string
	wildixUsersSlug: string
	overrides?: Partial<CollectionConfig>
}

export const createWildixDevicesCollection = ({
	slug,
	wildixUsersSlug,
	overrides,
}: CreateWildixDevicesCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		access: authenticatedCollectionAccess,
		labels: {
			singular: labelForKey(keys.wildixDevicesSingular),
			plural: labelForKey(keys.wildixDevicesPlural),
		},
		admin: {
			useAsTitle: 'contact',
			defaultColumns: ['contact', 'userAgent', 'online', 'isActiveDevice'],
			components: {
				listMenuItems: ['@10x-media/wildix/ui/WildixSyncButton#WildixDevicesSyncButton'],
			},
		},
		fields: [
			{
				name: 'wildixId',
				type: 'text',
				required: true,
				unique: true,
				admin: {
					description: labelForKey(keys.wildixDevicesDescWildixId),
					readOnly: true,
				},
			},
			{
				name: 'contact',
				type: 'text',
				admin: { description: labelForKey(keys.wildixDevicesDescContact) },
			},
			{
				name: 'userAgent',
				type: 'text',
				admin: { description: labelForKey(keys.wildixDevicesDescUserAgent) },
			},
			{
				type: 'row',
				fields: [
					{
						name: 'wildixUserId',
						type: 'text',
						admin: {
							description: labelForKey(keys.wildixDevicesDescWildixUserId),
							readOnly: true,
						},
					},
					{
						name: 'wildixUser',
						type: 'relationship',
						relationTo: wildixUsersSlug as 'users',
						admin: {
							description: labelForKey(keys.wildixDevicesDescWildixUser),
							readOnly: true,
						},
					},
				],
			},
			{
				type: 'row',
				fields: [
					{ name: 'online', type: 'checkbox', defaultValue: false },
					{
						name: 'isActiveDevice',
						label: labelForKey(keys.wildixDevicesLabelActiveDevice),
						type: 'checkbox',
						defaultValue: false,
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
