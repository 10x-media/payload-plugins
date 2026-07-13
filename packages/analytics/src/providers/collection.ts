import type { CollectionConfig, Field } from 'payload'
import { keys, type TranslationKey } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ProviderId } from './factory'
import { maskSecret, preserveMaskedSecret } from './secrets'

export const PROVIDERS_SLUG = 'analytics-providers'

export interface BuildProvidersCollectionArgs {
	slug: string
	access?: Partial<CollectionConfig['access']>
	overrides?: (collection: CollectionConfig) => CollectionConfig
	/** Called after any change or delete so the per-scope registry cache drops stale adapters. */
	onChange: () => void
}

const loggedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

const textField = (name: string, label: TranslationKey, width?: string): Field => ({
	name,
	type: 'text',
	label: labelForKey(label),
	...(width ? { admin: { width } } : {}),
})

const secretField = (name: string, label: TranslationKey, width?: string): Field => ({
	name,
	type: 'text',
	label: labelForKey(label),
	admin: { description: labelForKey(keys.providerSecretHelp), ...(width ? { width } : {}) },
	hooks: { beforeChange: [preserveMaskedSecret], afterRead: [maskSecret] },
})

const hostField = (): Field => ({
	name: 'host',
	type: 'text',
	label: labelForKey(keys.providerFieldHost),
	admin: { description: labelForKey(keys.providerFieldHostHelp) },
})

const providerGroup = (provider: ProviderId, label: TranslationKey, fields: Field[]): Field => ({
	name: provider,
	type: 'group',
	label: labelForKey(label),
	admin: { condition: (data) => data?.provider === provider },
	fields,
})

/**
 * The runtime provider-settings collection: one document per provider (and per scope
 * in scoped installs). Admin-only by default; `access` entries override individual
 * operations and `overrides` reshapes the whole config last, so slugs, labels,
 * fields, and access all stay overridable.
 */
export const buildProvidersCollection = (args: BuildProvidersCollectionArgs): CollectionConfig => {
	const collection: CollectionConfig = {
		slug: args.slug,
		labels: {
			singular: labelForKey(keys.providersCollectionSingular),
			plural: labelForKey(keys.providersCollectionPlural),
		},
		admin: {
			useAsTitle: 'provider',
			defaultColumns: ['provider', 'enabled'],
			group: 'Analytics',
		},
		access: {
			read: loggedIn,
			create: loggedIn,
			update: loggedIn,
			delete: loggedIn,
			...args.access,
		},
		hooks: {
			afterChange: [
				({ doc }) => {
					args.onChange()
					return doc
				},
			],
			afterDelete: [
				({ doc }) => {
					args.onChange()
					return doc
				},
			],
		},
		fields: [
			{
				type: 'row',
				fields: [
					{
						name: 'provider',
						type: 'select',
						required: true,
						label: labelForKey(keys.providerFieldProvider),
						options: [
							{ label: labelForKey(keys.providerNamePlausible), value: 'plausible' },
							{ label: labelForKey(keys.providerNameUmami), value: 'umami' },
							{ label: labelForKey(keys.providerNameGa4), value: 'ga4' },
							{ label: labelForKey(keys.providerNamePosthog), value: 'posthog' },
						],
						admin: { width: '50%' },
					},
					{
						name: 'enabled',
						type: 'checkbox',
						defaultValue: true,
						label: labelForKey(keys.providerFieldEnabled),
						admin: { width: '50%', style: { alignSelf: 'flex-end' } },
					},
				],
			},
			{
				// Written by scoped setups (or a tenant plugin's own field via `scopeField`);
				// hidden because single-site installs never touch it.
				name: 'scope',
				type: 'text',
				index: true,
				label: labelForKey(keys.providerFieldScope),
				admin: { hidden: true },
			},
			providerGroup('plausible', keys.providerNamePlausible, [
				{
					type: 'row',
					fields: [
						textField('siteId', keys.providerFieldSiteId, '50%'),
						secretField('apiKey', keys.providerFieldApiKey, '50%'),
					],
				},
				hostField(),
			]),
			providerGroup('umami', keys.providerNameUmami, [
				{
					type: 'row',
					fields: [
						textField('websiteId', keys.providerFieldWebsiteId, '50%'),
						secretField('apiKey', keys.providerFieldApiKey, '50%'),
					],
				},
				secretField('token', keys.providerFieldToken),
				hostField(),
			]),
			providerGroup('ga4', keys.providerNameGa4, [
				{
					type: 'row',
					fields: [
						textField('propertyId', keys.providerFieldPropertyId, '50%'),
						textField('projectId', keys.providerFieldProjectId, '50%'),
					],
				},
				textField('clientEmail', keys.providerFieldClientEmail),
				{
					name: 'privateKey',
					type: 'textarea',
					label: labelForKey(keys.providerFieldPrivateKey),
					admin: { description: labelForKey(keys.providerSecretHelp) },
					hooks: { beforeChange: [preserveMaskedSecret], afterRead: [maskSecret] },
				},
			]),
			providerGroup('posthog', keys.providerNamePosthog, [
				{
					type: 'row',
					fields: [
						textField('projectId', keys.providerFieldProjectId, '50%'),
						secretField('apiKey', keys.providerFieldApiKey, '50%'),
					],
				},
				hostField(),
			]),
		],
	}
	return args.overrides ? args.overrides(collection) : collection
}
