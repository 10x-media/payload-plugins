import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'

type CreateSipgateUsersCollectionOptions = {
	slug: string
	/** One or more Payload auth collection slugs to link against. */
	payloadUsersSlug: CollectionSlug | CollectionSlug[]
	overrides?: Partial<CollectionConfig>
}

export const createSipgateUsersCollection = ({
	slug,
	payloadUsersSlug,
	overrides,
}: CreateSipgateUsersCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: 'Sipgate User',
			plural: 'Sipgate Users',
		},
		admin: {
			useAsTitle: 'email',
			defaultColumns: ['firstname', 'lastname', 'email', 'id', 'payloadUser'],
			components: {
				listMenuItems: ['@10x-media/sipgate/ui/SipgateSyncButton#SipgateUsersSyncButton'],
			},
		},
		fields: [
			{
				name: 'id',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: 'Sipgate user ID (e.g. w0)' },
			},
			{
				type: 'row',
				fields: [
					{
						name: 'firstname',
						type: 'text',
					},
					{
						name: 'lastname',
						type: 'text',
					},
				],
			},
			{
				name: 'email',
				type: 'email',
			},
			{
				name: 'defaultDevice',
				type: 'text',
				admin: { description: 'Default device ID (e.g. e0)' },
			},
			{
				name: 'admin',
				type: 'checkbox',
				defaultValue: false,
			},
			{
				name: 'busyOnBusy',
				type: 'checkbox',
				defaultValue: false,
				admin: {
					description: 'Reject new incoming calls when already on a call',
				},
			},
			{
				name: 'timezone',
				type: 'text',
			},
			{
				name: 'addressId',
				type: 'text',
				admin: { readOnly: true },
			},
			{
				name: 'payloadUser',
				type: 'relationship',
				relationTo: Array.isArray(payloadUsersSlug) ? payloadUsersSlug : [payloadUsersSlug],
				hasMany: false,
				required: false,
				admin: {
					description: 'Link to the corresponding Payload user account',
				},
			},
		],
	}

	if (overrides) {
		return deepMerge(defaults, overrides)
	}

	return defaults
}
