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
	/**
	 * When true, multiple Payload users may link to the same Sipgate account.
	 * Removes the unique constraint on the sipgate user ID field so that the same
	 * account can be claimed by more than one Payload user.
	 */
	allowSharedSipgateAccount?: boolean
	overrides?: Partial<CollectionConfig>
}

export const createSipgateUsersCollection = ({
	slug,
	payloadUsersSlug,
	includeOAuthFields,
	allowSharedSipgateAccount = false,
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
			defaultColumns: ['firstname', 'lastname', 'email', 'sipgateId', 'payloadUser'],
			components: {
				listMenuItems: ['@10x-media/sipgate/ui/SipgateSyncButton#SipgateUsersSyncButton'],
			},
		},
		fields: [
			{
				name: 'sipgateId',
				type: 'text',
				required: true,
				unique: !allowSharedSipgateAccount,
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
							access: { read: () => false as const },
							admin: {
								hidden: true,
								description: labelForKey(keys.sipgateUsersDescAccessToken),
							},
						},
						{
							name: 'refreshToken',
							type: 'text' as const,
							saveToJWT: false,
							access: { read: () => false as const },
							admin: {
								hidden: true,
								description: labelForKey(keys.sipgateUsersDescRefreshToken),
							},
						},
						{
							name: 'tokenExpiresAt',
							type: 'date' as const,
							saveToJWT: false,
							access: { read: () => false as const },
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
