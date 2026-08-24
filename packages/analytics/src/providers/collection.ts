import type { CollectionConfig, Field, TextareaField, TextField } from 'payload'
import { keys, type TranslationKey } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ProviderAccessArgs } from './access'
import { providerCreateAccess, providerRowAccess } from './access'
import type { ProviderId } from './factory'
import { stampScope } from './stampScope'

export const PROVIDERS_SLUG = 'analytics-providers'

export type BuildSecretField = (source: TextField | TextareaField) => Field[]

export interface BuildProvidersCollectionArgs extends ProviderAccessArgs {
	slug: string
	access?: Partial<CollectionConfig['access']>
	overrides?: (collection: CollectionConfig) => CollectionConfig
	/** Called after any change or delete so the per-scope registry cache drops stale adapters. */
	onChange: () => void
	buildSecret: BuildSecretField
}

const textField = (name: string, label: TranslationKey, width?: string): Field => ({
	name,
	type: 'text',
	label: labelForKey(label),
	...(width ? { admin: { width } } : {}),
})

const secretField = (
	args: BuildProvidersCollectionArgs,
	opts: { name: string; label: TranslationKey; width?: string }
): Field[] =>
	args.buildSecret({
		name: opts.name,
		type: 'text',
		label: labelForKey(opts.label),
		...(opts.width ? { admin: { width: opts.width } } : {}),
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
			useAsTitle: 'name',
			defaultColumns: ['name', 'provider', 'enabled'],
			group: 'Analytics',
		},
		access: {
			read: providerRowAccess(args),
			create: providerCreateAccess(args),
			update: providerRowAccess(args),
			delete: providerRowAccess(args),
			...args.access,
		},
		hooks: {
			beforeChange: [stampScope(args)],
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
				name: 'name',
				type: 'text',
				required: true,
				label: labelForKey(keys.providerFieldName),
			},
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
						...secretField(args, { name: 'apiKey', label: keys.providerFieldApiKey, width: '50%' }),
					],
				},
				hostField(),
			]),
			providerGroup('umami', keys.providerNameUmami, [
				{
					type: 'row',
					fields: [
						textField('websiteId', keys.providerFieldWebsiteId, '50%'),
						...secretField(args, { name: 'apiKey', label: keys.providerFieldApiKey, width: '50%' }),
					],
				},
				...secretField(args, { name: 'token', label: keys.providerFieldToken }),
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
				...args.buildSecret({
					name: 'privateKey',
					type: 'textarea',
					label: labelForKey(keys.providerFieldPrivateKey),
				}),
			]),
			providerGroup('posthog', keys.providerNamePosthog, [
				{
					type: 'row',
					fields: [
						textField('projectId', keys.providerFieldProjectId, '50%'),
						...secretField(args, { name: 'apiKey', label: keys.providerFieldApiKey, width: '50%' }),
					],
				},
				hostField(),
			]),
		],
	}
	return args.overrides ? args.overrides(collection) : collection
}
