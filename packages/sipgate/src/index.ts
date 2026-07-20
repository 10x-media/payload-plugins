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
import { createSipgateChannelsCollection } from './collections/Channels'
import { createSipgateDevicesCollection } from './collections/Devices'
import { createIvrFlowsCollection } from './collections/IvrFlows'
import { createIvrVoiceLinesCollection } from './collections/IvrVoiceLines'
import { createSipgateUsersCollection } from './collections/SipgateUsers'
import { createSipgateActiveCall } from './endpoints/sipgate.activeCall'
import { createSipgateContacts } from './endpoints/sipgate.contacts'
import { createSipgateDevices } from './endpoints/sipgate.devices'
import { createSipgateDial } from './endpoints/sipgate.dial'
import { createSipgateIvr } from './endpoints/sipgate.ivr'
import { createSipgateOAuthCallback, createSipgateOAuthConnect } from './endpoints/sipgate.oauth'
import { createSipgateOAuthSync } from './endpoints/sipgate.oauthSync'
import { createSipgateRtcm } from './endpoints/sipgate.rtcm'
import { createSipgateSync } from './endpoints/sipgate.sync'
import { createSipgateWebhooks } from './endpoints/sipgate.webhooks'
import { createContactMatchUiField } from './fields/contactMatchUi.field'
import { createPhoneNumberField } from './fields/phoneNumber.field'
import { registerTranslations } from './plugin/registerTranslations'
import {
	buildSyncCallHistoryTask,
	buildSyncCallHistoryTaskOAuth,
} from './tasks/syncCallHistoryTask'
import type { LiveCallPosition, SipgateCredentials } from './types'
import type { SipgateAccess } from './utils/access'
import { createCallActivityWidget } from './widgets/callActivity.widget'
import { createLiveCallFloatingWindow } from './widgets/liveCallFloatingWindow.component'

export type { SipgateAuthType, SipgateCredentials } from './types'
export type { SipgateAccess, SipgateAccessFn } from './utils/access'
export { createSipgateOnInit, type SipgateOnInitSlugs } from './utils/sipgateSyncHandlers'

export type SipgatePluginOptions = {
	/**
	 * Whether to disable the plugin.
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
	 * Whether to sync call logs from the Sipgate API.
	 */
	syncCallLogs?: boolean

	/**
	 * The credentials to use for the Sipgate API.
	 */
	sipgateCredentials?: SipgateCredentials

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
	 * When true (default), the device list is filtered to devices belonging to the logged-in
	 * Payload user's linked sipgate account. Set to false to show all devices to all users.
	 * Has no effect when `singleUser` is set.
	 * @default true
	 */
	filterDevicesByUser?: boolean

	/**
	 * Access control for sipgate endpoints. Each key maps to a specific endpoint.
	 * The `default` key is used as a fallback when no endpoint-specific function is set.
	 * Defaults to requiring an authenticated Payload user (`req.user != null`).
	 * The webhooks endpoint is always public (sipgate servers call it without a user session).
	 */
	access?: SipgateAccess

	payloadUsersSlug?: CollectionSlug | CollectionSlug[]

	/**
	 * When true, multiple Payload users may link to the same Sipgate account via OAuth2.
	 * By default each Sipgate account can only be claimed by one Payload user; a second
	 * attempt returns a clear error. Enabling this removes that restriction and also drops
	 * the unique-index on the sipgate user ID field in the `sipgate-users` collection
	 * (requires a DB migration when toggled on existing data).
	 * @default false
	 */
	allowSharedSipgateAccount?: boolean

	/**
	 * When set, all dial and device operations are scoped to this Sipgate user.
	 * Useful for single-account setups where all Payload users share one Sipgate identity.
	 * The email is matched against the `sipgate-users` collection (populated by sync).
	 */
	singleUser?: {
		/** Sipgate account email address. */
		email: string
	}

	/**
	 * Enable the IVR (Interactive Voice Response) system.
	 * When enabled, two Payload collections are registered: one for uploaded voice line audio
	 * files and one for IVR flow definitions. Incoming calls are routed through the configured
	 * flow when answered.
	 *
	 * Set to `false` or omit to disable. Set to `true` or an object to enable.
	 */
	ivr?:
		| {
				/**
				 * Slug for the voice lines upload collection.
				 * @default 'ivr-voice-lines'
				 */
				voiceLinesSlug?: string
				/**
				 * Slug for the IVR flows collection.
				 * @default 'ivr-flows'
				 */
				flowsSlug?: string
		  }
		| true
		| false

	/**
	 * Public base URL for OAuth redirect URIs and IVR webhook callbacks
	 * (e.g. `https://your-app.com` or `https://abc.ngrok.io`).
	 * Required when `authType` is `'oauth2'` or the `ivr` option is enabled.
	 * Must be reachable by Sipgate's servers — not `localhost`.
	 */
	webhookUrl?: string

	/**
	 * The overrides to use for the plugin.
	 */
	overrides?: {
		callLogs?: Partial<CollectionConfig>
		sipgateUsers?: Partial<CollectionConfig>
		sipgateDevices?: Partial<CollectionConfig>
		sipgateChannels?: Partial<CollectionConfig>
		ivrVoiceLines?: Partial<CollectionConfig>
		ivrFlows?: Partial<CollectionConfig>
		allActivityWidget?: Partial<Widget>
		sipgateWebhooks?: Partial<Endpoint>
		sipgateActiveCall?: Partial<Endpoint>
		sipgateDial?: Partial<Endpoint>
		sipgateRtcm?: Partial<Endpoint>
		sipgateContacts?: Partial<Endpoint>
		sipgateIvr?: Partial<Endpoint>
		liveCallFloatingWindow?: Partial<CustomComponent<Record<string, never>>>
	}
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/sipgate': SipgatePluginOptions
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

export const sipgate = definePlugin<SipgatePluginOptions>({
	slug: '@10x-media/sipgate',
	order: 10,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config)

		const callLogsSlug = 'call-logs'
		const sipgateUsersSlug = 'sipgate-users'
		const sipgateDevicesSlug = 'sipgate-devices'
		const sipgateChannelsSlug = 'sipgate-channels'
		const contactCollections = options.contactCollections ?? []
		const phoneNumberFields = options.phoneNumberFields ?? []

		const ivrOptions = options.ivr === true ? {} : (options.ivr ?? false)
		const ivrEnabled = ivrOptions !== false
		const ivrVoiceLinesSlug = ivrEnabled ? (ivrOptions.voiceLinesSlug ?? 'ivr-voice-lines') : ''
		const ivrFlowsSlug = ivrEnabled ? (ivrOptions.flowsSlug ?? 'ivr-flows') : ''

		if (!config.collections) config.collections = []

		if (ivrEnabled) {
			config.collections.push(
				createIvrVoiceLinesCollection(ivrVoiceLinesSlug, options.overrides?.ivrVoiceLines),
				createIvrFlowsCollection(ivrFlowsSlug, ivrVoiceLinesSlug, options.overrides?.ivrFlows)
			)
		}

		const isOAuth2 = options.sipgateCredentials?.authType === 'oauth2'

		config.collections.push(
			createCallLogsCollection({
				contactCollections,
				phoneNumberFields,
				overrides: options.overrides?.callLogs,
				enableSyncButton: !!options.sipgateCredentials,
			}),
			createSipgateUsersCollection({
				slug: sipgateUsersSlug,
				payloadUsersSlug: options.payloadUsersSlug ?? 'users',
				includeOAuthFields: isOAuth2,
				allowSharedSipgateAccount: options.allowSharedSipgateAccount ?? false,
				overrides: options.overrides?.sipgateUsers,
			}),
			createSipgateDevicesCollection({
				slug: sipgateDevicesSlug,
				sipgateUsersSlug,
				overrides: options.overrides?.sipgateDevices,
			}),
			createSipgateChannelsCollection({
				slug: sipgateChannelsSlug,
				sipgateUsersSlug,
				overrides: options.overrides?.sipgateChannels,
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

		const needsWebhookUrl = isOAuth2 || ivrEnabled
		if (needsWebhookUrl && !options.webhookUrl) {
			throw new Error(
				'[@10x-media/sipgate] webhookUrl is required when using OAuth2 or IVR. ' +
					'Set it to the public base URL of your Payload instance (e.g. https://your-app.com).'
			)
		}
		const webhookUrl = options.webhookUrl ?? ''
		const adminBaseUrl = config.serverURL ?? ''

		config.endpoints.push(
			createSipgateWebhooks({
				callLogsSlug,
				webhookUrl: options.webhookUrl,
				ivr: ivrEnabled
					? {
							flowsSlug: ivrFlowsSlug,
							ivrEndpointUrl: `${webhookUrl}/api/sipgate/ivr`,
						}
					: undefined,
				overrides: options.overrides?.sipgateWebhooks,
			}),
			createSipgateActiveCall(
				options.access,
				options.overrides?.sipgateActiveCall,
				sipgateUsersSlug
			),
			createSipgateDevices({
				sipgateDevicesSlug,
				sipgateUsersSlug,
				access: options.access,
				singleUserEmail: options.singleUser?.email,
				filterDevicesByUser: options.filterDevicesByUser,
			})
		)

		if (ivrEnabled) {
			config.endpoints.push(
				createSipgateIvr({
					flowsSlug: ivrFlowsSlug,
					voiceLinesSlug: ivrVoiceLinesSlug,
					ivrEndpointUrl: `${webhookUrl}/api/sipgate/ivr`,
					overrides: options.overrides?.sipgateIvr,
				})
			)
		}

		if (options.sipgateCredentials) {
			config.endpoints.push(
				createSipgateDial({
					credentials: options.sipgateCredentials,
					access: options.access,
					singleUserEmail: options.singleUser?.email,
					sipgateUsersSlug,
					sipgateChannelsSlug,
					overrides: options.overrides?.sipgateDial,
				})
			)

			config.endpoints.push(
				createSipgateRtcm({
					credentials: options.sipgateCredentials,
					access: options.access,
					sipgateUsersSlug,
					overrides: options.overrides?.sipgateRtcm,
				}),
				createSipgateContacts({
					credentials: options.sipgateCredentials,
					access: options.access,
					sipgateUsersSlug,
					overrides: options.overrides?.sipgateContacts,
				})
			)

			if (isOAuth2) {
				const rawPayloadUsersSlug = options.payloadUsersSlug ?? 'users'
				const singlePayloadUsersSlug = Array.isArray(rawPayloadUsersSlug)
					? (rawPayloadUsersSlug[0] ?? 'users')
					: rawPayloadUsersSlug
				config.endpoints.push(
					createSipgateOAuthConnect({
						credentials: options.sipgateCredentials,
						webhookUrl,
						adminBaseUrl,
						sipgateUsersSlug,
						sipgateDevicesSlug,
						sipgateChannelsSlug,
						payloadUsersSlug: singlePayloadUsersSlug,
					}),
					createSipgateOAuthCallback({
						credentials: options.sipgateCredentials,
						webhookUrl,
						adminBaseUrl,
						sipgateUsersSlug,
						sipgateDevicesSlug,
						sipgateChannelsSlug,
						payloadUsersSlug: singlePayloadUsersSlug,
						allowSharedSipgateAccount: options.allowSharedSipgateAccount ?? false,
					}),
					createSipgateOAuthSync({
						credentials: options.sipgateCredentials,
						sipgateUsersSlug,
						sipgateDevicesSlug,
						sipgateChannelsSlug,
						callLogsSlug,
						access: options.access,
					})
				)
			} else {
				config.endpoints.push(
					createSipgateSync({
						credentials: options.sipgateCredentials,
						sipgateUsersSlug,
						sipgateDevicesSlug,
						sipgateChannelsSlug,
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
						name: 'sipgateConnection',
						type: 'ui',
						admin: {
							components: {
								Field: '@10x-media/sipgate/ui/SipgateOAuthButton',
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
				createCallActivityWidget(options.overrides?.allActivityWidget)
			)
		}

		if (options.syncCallLogs && options.sipgateCredentials) {
			config.jobs ??= {}
			config.jobs.tasks ??= []
			if (isOAuth2) {
				config.jobs.tasks.push(
					buildSyncCallHistoryTaskOAuth({
						callLogsSlug,
						sipgateUsersSlug,
						credentials: options.sipgateCredentials,
					})
				)
			} else {
				config.jobs.tasks.push(
					buildSyncCallHistoryTask({
						callLogsSlug,
						credentials: options.sipgateCredentials,
					})
				)
			}
		}

		return config
	},
})

export type { SipgatePluginOptions as PluginOptions }
