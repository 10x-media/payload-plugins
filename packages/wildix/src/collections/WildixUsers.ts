import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

type CreateWildixUsersCollectionOptions = {
	slug: string
	/** One or more Payload auth collection slugs to link against. */
	payloadUsersSlug: CollectionSlug | CollectionSlug[]
	/** When true, adds hidden OAuth2 token fields (accessToken, refreshToken, tokenExpiresAt). */
	includeOAuthFields?: boolean
	overrides?: Partial<CollectionConfig>
}

export const createWildixUsersCollection = ({
	slug,
	payloadUsersSlug,
	includeOAuthFields,
	overrides,
}: CreateWildixUsersCollectionOptions): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: labelForKey(keys.wildixUsersSingular),
			plural: labelForKey(keys.wildixUsersPlural),
		},
		admin: {
			useAsTitle: 'email',
			defaultColumns: ['name', 'extension', 'email', 'wildixId', 'payloadUser'],
			components: {
				listMenuItems: ['@10x-media/wildix/ui/WildixSyncButton#WildixUsersSyncButton'],
			},
		},
		fields: [
			{
				name: 'wildixId',
				type: 'text',
				required: true,
				unique: true,
				admin: { description: labelForKey(keys.wildixUsersDescUserId) },
			},
			{ name: 'name', type: 'text' },
			{
				name: 'extension',
				type: 'text',
				admin: { description: labelForKey(keys.wildixUsersDescExtension) },
			},
			{ name: 'email', type: 'email' },
			{
				type: 'row',
				fields: [
					{ name: 'officePhone', type: 'text' },
					{ name: 'mobilePhone', type: 'text' },
				],
			},
			{
				type: 'row',
				fields: [
					{ name: 'role', type: 'text', admin: { readOnly: true } },
					{ name: 'department', type: 'text' },
				],
			},
			{
				type: 'row',
				fields: [
					{ name: 'dialplan', type: 'text', admin: { readOnly: true } },
					{ name: 'language', type: 'text' },
				],
			},
			{
				name: 'defaultDevice',
				type: 'text',
				admin: { description: labelForKey(keys.wildixUsersDescDefaultDevice) },
			},
			{
				name: 'payloadUser',
				type: 'relationship',
				relationTo: Array.isArray(payloadUsersSlug) ? payloadUsersSlug : [payloadUsersSlug],
				hasMany: false,
				required: false,
				admin: { description: labelForKey(keys.wildixUsersDescPayloadUser) },
			},
			...(includeOAuthFields
				? [
						{
							name: 'needsReconnect',
							type: 'checkbox' as const,
							defaultValue: false,
							saveToJWT: false,
							access: { read: () => false as const },
							admin: { hidden: true },
						},
						{
							name: 'accessToken',
							type: 'text' as const,
							saveToJWT: false,
							access: { read: () => false as const },
							admin: { hidden: true, description: labelForKey(keys.wildixUsersDescAccessToken) },
						},
						{
							name: 'refreshToken',
							type: 'text' as const,
							saveToJWT: false,
							access: { read: () => false as const },
							admin: { hidden: true, description: labelForKey(keys.wildixUsersDescRefreshToken) },
						},
						{
							name: 'tokenExpiresAt',
							type: 'date' as const,
							saveToJWT: false,
							access: { read: () => false as const },
							admin: {
								readOnly: true,
								description: labelForKey(keys.wildixUsersDescTokenExpiresAt),
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
