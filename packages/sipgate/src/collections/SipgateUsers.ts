import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

type CreateSipgateUsersCollectionOptions = {
	slug: string
	/** One or more Payload auth collection slugs to link against. */
	payloadUsersSlug: CollectionSlug | CollectionSlug[]
	/** When true, adds hidden OAuth2 token fields (accessToken, refreshToken, tokenExpiresAt). */
	includeOAuthFields?: boolean
	overrides?: Partial<CollectionConfig>
}

export const createSipgateUsersCollection = ({
	slug,
	payloadUsersSlug,
	includeOAuthFields,
	overrides,
}: CreateSipgateUsersCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: labelForKey(keys.sipgateUsersSingular),
			plural: labelForKey(keys.sipgateUsersPlural),
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
				admin: { description: labelForKey(keys.sipgateUsersDescUserId) },
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
				admin: { description: labelForKey(keys.sipgateUsersDescDefaultDevice) },
			},
			{
				name: 'defaultChannel',
				type: 'text',
				admin: {
					description: labelForKey(keys.sipgateUsersDescDefaultChannel),
					readOnly: true,
				},
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
					description: labelForKey(keys.sipgateUsersDescBusyOnBusy),
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
					description: labelForKey(keys.sipgateUsersDescPayloadUser),
				},
			},
			...(includeOAuthFields
				? [
						{
							name: 'accessToken',
							type: 'text' as const,
							saveToJWT: false,
							admin: {
								hidden: true,
								description: labelForKey(keys.sipgateUsersDescAccessToken),
							},
						},
						{
							name: 'refreshToken',
							type: 'text' as const,
							saveToJWT: false,
							admin: {
								hidden: true,
								description: labelForKey(keys.sipgateUsersDescRefreshToken),
							},
						},
						{
							name: 'tokenExpiresAt',
							type: 'date' as const,
							saveToJWT: false,
							admin: {
								readOnly: true,
								description: labelForKey(keys.sipgateUsersDescTokenExpiresAt),
							},
						},
					]
				: []),
		],
	}

	if (overrides) {
		return deepMerge(defaults, overrides)
	}

	return defaults
}
