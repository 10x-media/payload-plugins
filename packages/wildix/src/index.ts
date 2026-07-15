import {
	type CollectionConfig,
	type CollectionSlug,
	type Config,
	type CustomComponent,
	definePlugin,
	type Endpoint,
	type Field,
	type Widget,
} from 'payload'
import { fieldAffectsData } from 'payload/shared'
import { createCallLogsCollection } from './collections/CallLogs'
import { createWildixChannelsCollection } from './collections/WildixChannels'
import { createWildixDevicesCollection } from './collections/WildixDevices'
import { createWildixUsersCollection } from './collections/WildixUsers'
import { createWildixActiveCall } from './endpoints/wildix.activeCall'
import { createWildixContacts } from './endpoints/wildix.contacts'
import { createWildixDevices } from './endpoints/wildix.devices'
import { createWildixDial } from './endpoints/wildix.dial'
import { createWildixOAuthCallback, createWildixOAuthConnect } from './endpoints/wildix.oauth'
import { createWildixOAuthSync } from './endpoints/wildix.oauthSync'
import { createWildixRtcm } from './endpoints/wildix.rtcm'
import { createWildixSync } from './endpoints/wildix.sync'
import { createWildixWebhooks } from './endpoints/wildix.webhooks'
import { createContactMatchUiField } from './fields/contactMatchUi.field'
import { createPhoneNumberField } from './fields/phoneNumber.field'
import { registerTranslations } from './plugin/registerTranslations'
import {
	buildSyncCallHistoryTask,
	buildSyncCallHistoryTaskOAuth,
} from './tasks/syncCallHistoryTask'
import type { TranslationsOption } from './translations'
import type { LiveCallPosition, WildixCredentials } from './types'
import type { WildixAccess } from './utils/access'
import { createCallActivityWidget } from './widgets/callActivity.widget'
import { createLiveCallFloatingWindow } from './widgets/liveCallFloatingWindow.component'

export type { WildixAuthType, WildixCredentials } from './types'
export type { WildixAccess, WildixAccessFn } from './utils/access'
export { createWildixOnInit } from './utils/wildixSyncHandlers'

export type WildixPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 */
	disabled?: boolean

	/**
	 * Your collections with phone number fields.
	 */
	contactCollections?: CollectionSlug[]

	/**
	 * These field slugs will be used to identify phoneNumber fields on your contact collections.
	 */
	phoneNumberFields?: string[]

	/**
	 * Whether to sync call logs from the Wildix WDA history API.
	 */
	syncCallLogs?: boolean

	/**
	 * The credentials to use for the Wildix API.
	 */
	wildixCredentials?: WildixCredentials

	/**
	 * Shared secret configured in the WMS webhook integration, used to validate the
	 * `x-signature` HMAC header. Strongly recommended in production.
	 */
	webhookSecret?: string

	/**
	 * Whether to enable the call activity widget.
	 */
	enableCallActivityWidget?: boolean

	/**
	 * Whether to enable the live call floating window.
	 */
	enableLiveCallFloatingWindow?: boolean

	/**
	 * Corner where the live call floating window is anchored.
	 * @default 'bottom-right'
	 */
	liveCallPosition?: LiveCallPosition

	/**
	 * Whether to enable the contact match UI.
	 */
	enableContactMatchUi?: boolean

	/**
	 * Access control for Wildix endpoints. Each key maps to a specific endpoint.
	 * The `default` key is used as a fallback when no endpoint-specific function is set.
	 * Defaults to requiring an authenticated Payload user (`req.user != null`).
	 * The webhooks endpoint is always public (Wildix calls it without a user session);
	 * its authenticity is instead verified via the HMAC signature.
	 */
	access?: WildixAccess

	payloadUsersSlug?: CollectionSlug | CollectionSlug[]

	/**
	 * When true, multiple Payload users may link to the same Wildix account via OAuth2.
	 * By default each Wildix account can only be claimed by one Payload user; a second
	 * attempt returns a clear error.
	 * @default false
	 */
	allowSharedWildixAccount?: boolean

	/**
	 * When set, all dial and device operations are scoped to this Wildix user.
	 * Useful for single-account setups where all Payload users share one Wildix identity.
	 * The email is matched against the `wildix-users` collection (populated by sync).
	 */
	singleUser?: {
		/** Wildix account email address. */
		email: string
	}

	/**
	 * Public base URL for OAuth2 redirect URIs (e.g. `https://your-app.com` or
	 * `https://abc.ngrok.io`). Required when `wildixCredentials.authType` is `'oauth2'`.
	 * Must be reachable by the Wildix PBX, not `localhost`.
	 */
	webhookUrl?: string

	/**
	 * The overrides to use for the plugin.
	 */
	overrides?: {
		callLogs?: Partial<CollectionConfig>
		wildixUsers?: Partial<CollectionConfig>
		wildixDevices?: Partial<CollectionConfig>
		wildixChannels?: Partial<CollectionConfig>
		callActivityWidget?: Partial<Widget>
		wildixWebhooks?: Partial<Endpoint>
		wildixActiveCall?: Partial<Endpoint>
		wildixDial?: Partial<Endpoint>
		wildixRtcm?: Partial<Endpoint>
		wildixContacts?: Partial<Endpoint>
		wildixDevicesEndpoint?: Partial<Endpoint>
		liveCallFloatingWindow?: Partial<CustomComponent<Record<string, never>>>
	}

	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/wildix/i18n`.
	 */
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/wildix': WildixPluginOptions
	}
}

const mapPhoneNumberFields = (fields: Field[], phoneNumberFields: string[]): Field[] =>
	fields.map((field) => {
		if (fieldAffectsData(field) && phoneNumberFields.includes(field.name)) {
			return createPhoneNumberField(field)
		}
		if ('fields' in field && Array.isArray(field.fields)) {
			return { ...field, fields: mapPhoneNumberFields(field.fields, phoneNumberFields) }
		}
		if ('tabs' in field && Array.isArray(field.tabs)) {
			return {
				...field,
				tabs: field.tabs.map((tab) => ({
					...tab,
					fields: mapPhoneNumberFields(tab.fields ?? [], phoneNumberFields),
				})),
			}
		}
		return field
	})

export const wildix = definePlugin<WildixPluginOptions>({
	slug: '@10x-media/wildix',
	order: 10,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)

		const callLogsSlug = 'call-logs'
		const wildixUsersSlug = 'wildix-users'
		const wildixDevicesSlug = 'wildix-devices'
		const wildixChannelsSlug = 'wildix-channels'
		const contactCollections = options.contactCollections ?? []
		const phoneNumberFields = options.phoneNumberFields ?? []

		if (!config.collections) config.collections = []

		const isOAuth2 = options.wildixCredentials?.authType === 'oauth2'

		config.collections.push(
			createCallLogsCollection({
				contactCollections,
				phoneNumberFields,
				overrides: options.overrides?.callLogs,
				enableSyncButton: !!options.wildixCredentials,
			}),
			createWildixUsersCollection({
				slug: wildixUsersSlug,
				payloadUsersSlug: options.payloadUsersSlug ?? 'users',
				includeOAuthFields: isOAuth2,
				overrides: options.overrides?.wildixUsers,
			}),
			createWildixDevicesCollection({
				slug: wildixDevicesSlug,
				wildixUsersSlug,
				overrides: options.overrides?.wildixDevices,
			}),
			createWildixChannelsCollection({
				slug: wildixChannelsSlug,
				wildixUsersSlug,
				overrides: options.overrides?.wildixChannels,
			})
		)

		contactCollections.forEach((pluginCollectionSlug) => {
			if (!config.collections) return
			config.collections?.forEach((collection) => {
				if (collection.slug === pluginCollectionSlug) {
					if (options.enableContactMatchUi) {
						collection.fields.push(createContactMatchUiField(phoneNumberFields))
					}
					collection.fields = mapPhoneNumberFields(collection.fields, phoneNumberFields)
				}
			})
		})

		if (!config.endpoints) config.endpoints = []

		if (isOAuth2 && !options.webhookUrl) {
			throw new Error(
				'[@10x-media/wildix] webhookUrl is required when using OAuth2. ' +
					'Set it to the public base URL of your Payload instance (e.g. https://your-app.com).'
			)
		}
		const webhookUrl = options.webhookUrl ?? ''
		const adminBaseUrl = config.serverURL ?? ''

		config.endpoints.push(
			createWildixWebhooks({
				callLogsSlug,
				webhookSecret: options.webhookSecret,
				overrides: options.overrides?.wildixWebhooks,
			}),
			createWildixActiveCall(options.access, options.overrides?.wildixActiveCall, wildixUsersSlug),
			createWildixDevices({
				wildixDevicesSlug,
				wildixUsersSlug,
				access: options.access,
				overrides: options.overrides?.wildixDevicesEndpoint,
			})
		)

		if (options.wildixCredentials) {
			config.endpoints.push(
				createWildixDial({
					credentials: options.wildixCredentials,
					access: options.access,
					singleUserEmail: options.singleUser?.email,
					wildixUsersSlug,
					overrides: options.overrides?.wildixDial,
				}),
				createWildixRtcm({
					credentials: options.wildixCredentials,
					access: options.access,
					wildixUsersSlug,
					overrides: options.overrides?.wildixRtcm,
				}),
				createWildixContacts({
					credentials: options.wildixCredentials,
					access: options.access,
					wildixUsersSlug,
					overrides: options.overrides?.wildixContacts,
				})
			)

			if (isOAuth2) {
				const rawPayloadUsersSlug = options.payloadUsersSlug ?? 'users'
				const singlePayloadUsersSlug = Array.isArray(rawPayloadUsersSlug)
					? (rawPayloadUsersSlug[0] ?? 'users')
					: rawPayloadUsersSlug
				config.endpoints.push(
					createWildixOAuthConnect({
						credentials: options.wildixCredentials,
						webhookUrl,
						adminBaseUrl,
						wildixUsersSlug,
						wildixDevicesSlug,
						wildixChannelsSlug,
						payloadUsersSlug: singlePayloadUsersSlug,
					}),
					createWildixOAuthCallback({
						credentials: options.wildixCredentials,
						webhookUrl,
						adminBaseUrl,
						wildixUsersSlug,
						wildixDevicesSlug,
						wildixChannelsSlug,
						payloadUsersSlug: singlePayloadUsersSlug,
						allowSharedAccount: options.allowSharedWildixAccount ?? false,
					}),
					createWildixOAuthSync({
						credentials: options.wildixCredentials,
						wildixUsersSlug,
						wildixDevicesSlug,
						wildixChannelsSlug,
						callLogsSlug,
						access: options.access,
					})
				)
			} else {
				config.endpoints.push(
					createWildixSync({
						credentials: options.wildixCredentials,
						wildixUsersSlug,
						wildixDevicesSlug,
						wildixChannelsSlug,
						callLogsSlug,
						access: options.access,
					})
				)
			}
		}

		if (options.enableLiveCallFloatingWindow) {
			if (!config.admin) config.admin = {}
			if (!config.admin.components) config.admin.components = {}
			if (!config.admin.components.beforeNav) config.admin.components.beforeNav = []
			config.admin.components.beforeNav.push(
				createLiveCallFloatingWindow(
					options.liveCallPosition ?? 'bottom-right',
					options.overrides?.liveCallFloatingWindow
				)
			)
		}

		if (isOAuth2) {
			const payloadUsersSlugsArr = Array.isArray(options.payloadUsersSlug)
				? options.payloadUsersSlug
				: [options.payloadUsersSlug ?? 'users']
			for (const collection of config.collections ?? []) {
				if ((payloadUsersSlugsArr as string[]).includes(collection.slug)) {
					if (!collection.fields) collection.fields = []
					collection.fields.push({
						name: 'wildixConnection',
						type: 'ui',
						admin: {
							components: {
								Field: '@10x-media/wildix/ui/WildixOAuthButton',
							},
						},
					})
				}
			}
		}

		if (options.enableCallActivityWidget) {
			if (!config.admin) config.admin = {}
			if (!config.admin?.dashboard) config.admin.dashboard = { widgets: [] }
			if (!config.admin?.dashboard?.widgets) config.admin.dashboard.widgets = []
			config.admin.dashboard.widgets.push(
				createCallActivityWidget(options.overrides?.callActivityWidget)
			)
		}

		if (options.syncCallLogs && options.wildixCredentials) {
			config.jobs ??= {}
			config.jobs.tasks ??= []
			if (isOAuth2) {
				config.jobs.tasks.push(
					buildSyncCallHistoryTaskOAuth({
						callLogsSlug,
						wildixUsersSlug,
						credentials: options.wildixCredentials,
					})
				)
			} else {
				config.jobs.tasks.push(
					buildSyncCallHistoryTask({
						callLogsSlug,
						credentials: options.wildixCredentials,
					})
				)
			}
		}

		return config
	},
})

export type { WildixPluginOptions as PluginOptions }
