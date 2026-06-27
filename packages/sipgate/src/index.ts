import {
	type CollectionConfig,
	type CollectionSlug,
	type Config,
	type CustomComponent,
	definePlugin,
	type Endpoint,
	type Widget,
} from 'payload'
import { fieldAffectsData } from 'payload/shared'
import { createCallLogsCollection } from './collections/CallLogs'
import { createSipgateChannelsCollection } from './collections/Channels'
import { createSipgateDevicesCollection } from './collections/Devices'
import { createSipgateUsersCollection } from './collections/SipgateUsers'
import { createSipgateActiveCall } from './endpoints/sipgate.activeCall'
import { createSipgateContacts } from './endpoints/sipgate.contacts'
import { createSipgateDevices } from './endpoints/sipgate.devices'
import { createSipgateDial } from './endpoints/sipgate.dial'
import { createSipgateRtcm } from './endpoints/sipgate.rtcm'
import { createSipgateSync } from './endpoints/sipgate.sync'
import { createSipgateWebhooks } from './endpoints/sipgate.webhooks'
import { createContactMatchUiField } from './fields/contactMatchUi.field'
import { createPhoneNumberField } from './fields/phoneNumber.field'
import { registerTranslations } from './plugin/registerTranslations'
import { buildSyncCallHistoryTask } from './tasks/syncCallHistoryTask'
import type { SipgateCredentials } from './types'
import type { SipgateAccess } from './utils/access'
import { createCallActivityWidget } from './widgets/callActivity.widget'
import { createLiveCallFloatingWindow } from './widgets/liveCallFloatingWindow.component'

export type { SipgateAccess, SipgateAccessFn } from './utils/access'

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
	 * Maximum number of device IDs to probe when discovering sipgate devices.
	 * Devices are probed as e0, e1, ... until a 404 is returned or this limit is reached.
	 * @default 25
	 */
	maxDeviceProbeCount?: number

	/**
	 * Access control for sipgate endpoints. Each key maps to a specific endpoint.
	 * The `default` key is used as a fallback when no endpoint-specific function is set.
	 * Defaults to requiring an authenticated Payload user (`req.user != null`).
	 * The webhooks endpoint is always public (sipgate servers call it without a user session).
	 */
	access?: SipgateAccess

	payloadUsersSlug?: CollectionSlug | CollectionSlug[]

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
	 * The overrides to use for the plugin.
	 */
	overrides?: {
		callLogs?: Partial<CollectionConfig>
		sipgateUsers?: Partial<CollectionConfig>
		sipgateDevices?: Partial<CollectionConfig>
		sipgateChannels?: Partial<CollectionConfig>
		allActivityWidget?: Partial<Widget>
		sipgateWebhooks?: Partial<Endpoint>
		sipgateActiveCall?: Partial<Endpoint>
		sipgateDial?: Partial<Endpoint>
		sipgateRtcm?: Partial<Endpoint>
		sipgateContacts?: Partial<Endpoint>
		liveCallFloatingWindow?: Partial<CustomComponent<Record<string, never>>>
	}
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/sipgate': SipgatePluginOptions
	}
}

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
		const maxDeviceProbeCount = options.maxDeviceProbeCount ?? 25

		if (!config.collections) config.collections = []
		config.collections.push(
			createCallLogsCollection(contactCollections, phoneNumberFields, options.overrides?.callLogs),
			createSipgateUsersCollection({
				slug: sipgateUsersSlug,
				payloadUsersSlug: options.payloadUsersSlug ?? 'users',
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
					if (!options.enableContactMatchUi) {
						collection.fields.push(createContactMatchUiField(phoneNumberFields))
					}
					collection.fields = collection.fields?.map((field) => {
						if (fieldAffectsData(field) && phoneNumberFields.includes(field.name)) {
							return createPhoneNumberField(field, {
								sipgateDevicesSlug,
								sipgateUsersSlug,
								filterDevicesByUser: options.filterDevicesByUser,
							})
						}
						return field
					})
				}
			})
		})

		if (!config.endpoints) config.endpoints = []
		config.endpoints.push(
			createSipgateWebhooks({
				contactCollections,
				phoneNumberFields,
				callLogsSlug,
				overrides: options.overrides?.sipgateWebhooks,
			}),
			createSipgateActiveCall(options.access, options.overrides?.sipgateActiveCall),
			createSipgateDevices({
				sipgateDevicesSlug,
				sipgateUsersSlug,
				access: options.access,
				singleUserEmail: options.singleUser?.email,
				filterDevicesByUser: options.filterDevicesByUser,
			})
		)

		if (options.sipgateCredentials) {
			config.endpoints.push(
				createSipgateDial({
					credentials: options.sipgateCredentials,
					access: options.access,
					singleUserEmail: options.singleUser?.email,
					sipgateUsersSlug,
					overrides: options.overrides?.sipgateDial,
				}),
				createSipgateRtcm(
					options.sipgateCredentials,
					options.access,
					options.overrides?.sipgateRtcm
				),
				createSipgateContacts(
					options.sipgateCredentials,
					options.access,
					options.overrides?.sipgateContacts
				),
				createSipgateSync({
					credentials: options.sipgateCredentials,
					sipgateUsersSlug,
					sipgateDevicesSlug,
					sipgateChannelsSlug,
					access: options.access,
				})
			)
		}

		if (options.enableLiveCallFloatingWindow) {
			if (!config.admin) config.admin = {}
			if (!config.admin.components) config.admin.components = {}
			if (!config.admin.components.beforeNav) config.admin.components.beforeNav = []
			config.admin.components.beforeNav.push(
				createLiveCallFloatingWindow(options.overrides?.liveCallFloatingWindow)
			)
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
			config.jobs.tasks.push(
				buildSyncCallHistoryTask({
					callLogsSlug,
					credentials: options.sipgateCredentials,
				})
			)
		}

		return config
	},
})

export type { SipgatePluginOptions as PluginOptions }
