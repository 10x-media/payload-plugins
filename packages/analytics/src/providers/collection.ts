import type {
	CollectionConfig,
	Field,
	FieldAccess,
	PayloadRequest,
	TextareaField,
	TextField,
	TextFieldSingleValidation,
} from 'payload'
import { validateMeasurementId } from '../adapters/ga4/measurementId'
import { validateScriptId } from '../adapters/plausible/scriptId'
import { optionsObject } from '../core/optionChecks'
import { kindOf } from '../core/values'
import { validateCurrency } from '../goals/currency'
import { type CollectionFieldOverride, overrideField } from '../plugin/collectionFields'
import { docScope, type ScopeChange } from '../plugin/scopeChange'
import { keys, type SingularKey, type TranslationKey } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { builtInStaticLabel, type StaticLabelFor } from '../translations/staticLabel'
import { type ProviderAccessArgs, providerCreateAccess, providerRowAccess } from './access'
import type { ProviderId } from './factory'
import { validateProviderHost } from './hosts'
import { retargetSecrets } from './retarget'
import { stampScope } from './stampScope'

export const PROVIDERS_SLUG = 'analytics-providers'

/** Builds the sealed variant of a secret source field; injected so the fields peer stays lazy. */
export type BuildSecretField = (source: TextField | TextareaField) => Field[]

/**
 * Replaces a default field; it receives the plugin's own field to spread and may return any field
 * type (a `row`, a `collapsible`) that still holds a field of that name.
 */
export type ProviderFieldOverride = CollectionFieldOverride

export interface ProviderCollectionFieldOverrides {
	name?: ProviderFieldOverride
	provider?: ProviderFieldOverride
	enabled?: ProviderFieldOverride
}

/** Field access on the fields that decide where a provider document connects (`CONNECTION_PATHS`). */
export interface ConnectionFieldAccess {
	create?: FieldAccess
	update?: FieldAccess
}

/** One field access function for create and update alike, or `{ create, update }`. */
export type ConnectionAccess = FieldAccess | ConnectionFieldAccess

/** `connectionAccess` in its object form, checked at boot; undefined while unset. */
export const connectionFieldAccess = (
	path: string,
	option: ConnectionAccess | undefined
): ConnectionFieldAccess | undefined => {
	if (option === undefined) {
		return undefined
	}
	if (typeof option === 'function') {
		return { create: option, update: option }
	}
	const halves = optionsObject(option, {
		path,
		known: ['create', 'update'],
		example: 'a function, or { create, update } with a function in each',
	})
	for (const [half, access] of Object.entries(halves)) {
		if (access !== undefined && typeof access !== 'function') {
			throw new Error(
				`analytics: ${path}.${half} must be a field access function, got ${kindOf(access)}`
			)
		}
	}
	const { create, update } = option
	return { ...(create ? { create } : {}), ...(update ? { update } : {}) }
}

export interface BuildProvidersCollectionArgs extends ProviderAccessArgs {
	slug: string
	access?: Partial<CollectionConfig['access']>
	/** Per-field overrides, applied before the whole-collection `overrides`. */
	fields?: ProviderCollectionFieldOverrides
	overrides?: (collection: CollectionConfig) => CollectionConfig
	/**
	 * Called after any change or delete with the scopes the write touched and the request that
	 * wrote, so that request's own Payload instance reads those scopes again once the write commits.
	 */
	onChange: (change: ScopeChange, req: PayloadRequest) => void | Promise<void>
	buildSecret: BuildSecretField
	/** The fields plugin's test for a sealed value, which tells a resent secret from a kept one. */
	isSealed: (value: unknown) => boolean
	/** `providers.hosts.allowPrivateNetwork`: the `host` fields accept `http://` too. */
	allowPrivateNetwork?: boolean
	connectionAccess?: ConnectionFieldAccess
	/** The install's static labels; the built-in strings alone when absent. */
	staticLabel?: StaticLabelFor
}

const plainSecret: BuildSecretField = (source) => [source]

const textField = (
	name: string,
	label: TranslationKey,
	opts: { width?: string; help?: TranslationKey; access?: ConnectionFieldAccess } = {}
): Field => ({
	name,
	type: 'text',
	label: labelForKey(label),
	...(opts.access ? { access: opts.access } : {}),
	...(opts.width || opts.help
		? {
				admin: {
					...(opts.width ? { width: opts.width } : {}),
					...(opts.help ? { description: labelForKey(opts.help) } : {}),
				},
			}
		: {}),
})

/**
 * A sealed credential. Its help is a string per locale: Payload drops a function description from
 * the client field, which the write-only editor renders.
 */
const secretField = (
	buildSecret: BuildSecretField,
	staticLabel: StaticLabelFor,
	opts: { name: string; label: TranslationKey; help: SingularKey; width?: string }
): Field[] =>
	buildSecret({
		name: opts.name,
		type: 'text',
		label: labelForKey(opts.label),
		admin: {
			description: staticLabel(opts.help),
			...(opts.width ? { width: opts.width } : {}),
		},
	})

/**
 * Public capture config, plain text because the tracker config serves it to the browser. An adapter
 * declares `capture` only once its public field is filled.
 */
const captureField = (
	name: string,
	label: TranslationKey,
	opts: { width?: string; validate?: TextFieldSingleValidation; help?: TranslationKey } = {}
): Field => ({
	name,
	type: 'text',
	label: labelForKey(label),
	...(opts.validate ? { validate: opts.validate } : {}),
	admin: {
		description: labelForKey(opts.help ?? keys.providerFieldCaptureHelp),
		...(opts.width ? { width: opts.width } : {}),
	},
})

/**
 * Only when `scopeField` names the plugin's own field: a host-owned scope field is the host's to
 * register, and shadowing it would store the scope twice.
 */
const scopeField = (include: boolean): Field[] =>
	include
		? [
				{
					// Written by scoped setups; hidden because single-site installs never touch it.
					name: 'scope',
					type: 'text',
					index: true,
					label: labelForKey(keys.providerFieldScope),
					admin: { hidden: true },
				},
			]
		: []

const hostField = (
	allowPrivateNetwork: boolean,
	access: ConnectionFieldAccess | undefined
): Field => ({
	name: 'host',
	type: 'text',
	label: labelForKey(keys.providerFieldHost),
	validate: validateProviderHost(allowPrivateNetwork),
	...(access ? { access } : {}),
	admin: { description: labelForKey(keys.providerFieldHostHelp) },
})

const currencyField = (name: string, help: TranslationKey): Field => ({
	name,
	type: 'text',
	label: labelForKey(keys.providerFieldRevenueCurrency),
	validate: validateCurrency,
	admin: { description: labelForKey(help) },
})

const providerGroup = (provider: ProviderId, label: TranslationKey, fields: Field[]): Field => ({
	name: provider,
	type: 'group',
	label: labelForKey(label),
	admin: { condition: (data) => data?.provider === provider },
	fields,
})

/**
 * The native choice configures nothing, so it gets a note in place of a settings group:
 * an unnamed group stores no data and reads as the section its siblings occupy.
 */
const nativeNote = (): Field => ({
	type: 'group',
	label: labelForKey(keys.providerNameNative),
	admin: {
		condition: (data) => data?.provider === 'native',
		description: labelForKey(keys.providerNameNativeHelp),
	},
	fields: [],
})

const nameField = (): Field => ({
	name: 'name',
	type: 'text',
	required: true,
	label: labelForKey(keys.providerFieldName),
	admin: { description: labelForKey(keys.providerFieldNameHelp) },
})

/**
 * Sits in the sidebar with `enabled`: every body field is conditional on the provider and
 * meaningless while `enabled` is off.
 */
const providerField = (
	access: ConnectionFieldAccess | undefined,
	staticLabel: StaticLabelFor
): Field => ({
	name: 'provider',
	type: 'select',
	required: true,
	label: labelForKey(keys.providerFieldProvider),
	defaultValue: 'native',
	...(access ? { access } : {}),
	options: [
		{ label: labelForKey(keys.providerNameNative), value: 'native' },
		{ label: labelForKey(keys.providerNamePlausible), value: 'plausible' },
		{ label: labelForKey(keys.providerNameUmami), value: 'umami' },
		{ label: labelForKey(keys.providerNameGa4), value: 'ga4' },
		{ label: labelForKey(keys.providerNamePosthog), value: 'posthog' },
	],
	// `admin.description` on a select is read where a label function never runs.
	admin: { position: 'sidebar', description: staticLabel(keys.providerFieldProviderHelp) },
})

const enabledField = (): Field => ({
	name: 'enabled',
	type: 'checkbox',
	defaultValue: true,
	label: labelForKey(keys.providerFieldEnabled),
	admin: { position: 'sidebar', description: labelForKey(keys.providerFieldEnabledHelp) },
})

export interface ProviderFieldsOptions {
	/**
	 * Seals each credential field, normally `encryptedField` from `@10x-media/fields` in write-only
	 * mode. Left out, credentials are plain text and securing them is the host's job.
	 */
	buildSecret?: BuildSecretField
	/** Replaces one of the default fields, applied per field. */
	fields?: ProviderCollectionFieldOverrides
	/** Adds the plugin's own hidden `scope` text field. Off by default. */
	scopeField?: boolean
	/**
	 * Accepts `http://` in a `host` field, for a vendor on a private network. Set it together with
	 * `providers.hosts.allowPrivateNetwork`, which lets the plugin connect there. Off, https only.
	 */
	allowPrivateNetwork?: boolean
	/**
	 * Field access on every `CONNECTION_PATHS` field except the scope field. One function for create
	 * and update alike, or `{ create, update }`.
	 */
	connectionAccess?: ConnectionAccess
}

/**
 * Provider-settings fields alone, for a host that stores them elsewhere and feeds them back through
 * `providers.resolve`; {@link adapterFromProviderDoc} reads the result as is.
 */
export const analyticsProviderFields = (options: ProviderFieldsOptions = {}): Field[] =>
	providerFields(options, builtInStaticLabel)

const providerFields = (options: ProviderFieldsOptions, staticLabel: StaticLabelFor): Field[] => {
	const buildSecret = options.buildSecret ?? plainSecret
	const access = connectionFieldAccess(
		'analyticsProviderFields({ connectionAccess })',
		options.connectionAccess
	)
	const allowPrivateNetwork = options.allowPrivateNetwork === true
	const apiKeyField = (): Field[] =>
		secretField(buildSecret, staticLabel, {
			name: 'apiKey',
			label: keys.providerFieldApiKey,
			help: keys.providerFieldApiKeyHelp,
			width: '50%',
		})
	return [
		overrideField(nameField(), options.fields?.name),
		overrideField(providerField(access, staticLabel), options.fields?.provider),
		overrideField(enabledField(), options.fields?.enabled),
		...scopeField(options.scopeField === true),
		nativeNote(),
		providerGroup('plausible', keys.providerNamePlausible, [
			{
				type: 'row',
				fields: [
					textField('siteId', keys.providerFieldSiteId, {
						width: '50%',
						help: keys.providerFieldSiteIdHelp,
						access,
					}),
					...apiKeyField(),
				],
			},
			{
				type: 'row',
				fields: [
					captureField('domain', keys.providerFieldDomain, {
						width: '50%',
						help: keys.providerFieldDomainHelp,
					}),
					captureField('scriptId', keys.providerFieldScriptId, {
						width: '50%',
						help: keys.providerFieldScriptIdHelp,
						validate: validateScriptId,
					}),
				],
			},
			currencyField('revenueCurrency', keys.providerFieldRevenueCurrencyHelp),
			hostField(allowPrivateNetwork, access),
		]),
		providerGroup('umami', keys.providerNameUmami, [
			{
				type: 'row',
				fields: [
					textField('websiteId', keys.providerFieldWebsiteId, {
						width: '50%',
						help: keys.providerFieldWebsiteIdHelp,
						access,
					}),
					...apiKeyField(),
				],
			},
			...secretField(buildSecret, staticLabel, {
				name: 'token',
				label: keys.providerFieldToken,
				help: keys.providerFieldTokenHelp,
			}),
			hostField(allowPrivateNetwork, access),
		]),
		providerGroup('ga4', keys.providerNameGa4, [
			{
				type: 'row',
				fields: [
					textField('propertyId', keys.providerFieldPropertyId, {
						width: '50%',
						help: keys.providerFieldPropertyIdHelp,
						access,
					}),
					textField('projectId', keys.providerFieldProjectId, {
						width: '50%',
						help: keys.providerFieldProjectIdHelp,
						access,
					}),
				],
			},
			textField('clientEmail', keys.providerFieldClientEmail, {
				help: keys.providerFieldClientEmailHelp,
				access,
			}),
			captureField('measurementId', keys.providerFieldMeasurementId, {
				validate: validateMeasurementId,
			}),
			currencyField('currency', keys.providerFieldGa4CurrencyHelp),
			...buildSecret({
				name: 'privateKey',
				type: 'textarea',
				label: labelForKey(keys.providerFieldPrivateKey),
				admin: { description: staticLabel(keys.providerFieldPrivateKeyHelp) },
			}),
		]),
		providerGroup('posthog', keys.providerNamePosthog, [
			{
				type: 'row',
				fields: [
					textField('projectId', keys.providerFieldProjectId, {
						width: '50%',
						help: keys.providerFieldProjectIdHelp,
						access,
					}),
					...apiKeyField(),
				],
			},
			{
				type: 'row',
				fields: [
					captureField('projectToken', keys.providerFieldProjectToken, { width: '50%' }),
					{
						name: 'region',
						type: 'select',
						label: labelForKey(keys.providerFieldRegion),
						options: [
							{ label: 'US', value: 'us' },
							{ label: 'EU', value: 'eu' },
						],
						...(access ? { access } : {}),
						admin: {
							width: '50%',
							description: staticLabel(keys.providerFieldRegionHelp),
						},
					},
				],
			},
			textField('scopeProperty', keys.providerFieldScopeProperty, {
				help: keys.providerFieldScopePropertyHelp,
				access,
			}),
			hostField(allowPrivateNetwork, access),
		]),
	]
}

/**
 * Runtime provider-settings collection, one document per provider (and scope). Admin-only by
 * default; `access` overrides single operations, `overrides` reshapes the whole config last.
 */
export const buildProvidersCollection = (args: BuildProvidersCollectionArgs): CollectionConfig => {
	const staticLabel = args.staticLabel ?? builtInStaticLabel
	const collection: CollectionConfig = {
		slug: args.slug,
		labels: {
			singular: labelForKey(keys.providersCollectionSingular),
			plural: labelForKey(keys.providersCollectionPlural),
		},
		disableDuplicate: true,
		admin: {
			useAsTitle: 'name',
			defaultColumns: ['name', 'provider', 'enabled'],
			group: staticLabel(keys.adminGroup),
			description: staticLabel(keys.providersCollectionDescription),
		},
		access: {
			read: providerRowAccess(args),
			create: providerCreateAccess(args),
			update: providerRowAccess(args),
			delete: providerRowAccess(args),
			...args.access,
		},
		hooks: {
			beforeChange: [
				stampScope(args),
				retargetSecrets({ scopeField: args.scopeField, isSealed: args.isSealed }),
			],
			afterChange: [
				async ({ doc, operation, previousDoc, req }) => {
					await args.onChange(
						{
							scope: docScope(doc, args.scopeField),
							...(operation === 'update'
								? { previousScope: docScope(previousDoc, args.scopeField) }
								: {}),
						},
						req
					)
					return doc
				},
			],
			afterDelete: [
				async ({ doc, req }) => {
					await args.onChange({ scope: docScope(doc, args.scopeField) }, req)
					return doc
				},
			],
		},
		fields: providerFields(
			{
				buildSecret: args.buildSecret,
				...(args.fields ? { fields: args.fields } : {}),
				scopeField: args.scopeField === 'scope',
				allowPrivateNetwork: args.allowPrivateNetwork === true,
				...(args.connectionAccess ? { connectionAccess: args.connectionAccess } : {}),
			},
			staticLabel
		),
	}
	return args.overrides ? args.overrides(collection) : collection
}
