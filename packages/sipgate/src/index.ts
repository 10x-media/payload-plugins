import {
	type CollectionConfig,
	type CollectionSlug,
	type Config,
	type CustomComponent,
	definePlugin,
	type Endpoint,
	type Widget,
} from 'payload'
import { createCallLogsCollection } from './collections/CallLogs'
import { createSipgateActiveCall } from './endpoints/sipgate.activeCall'
import { createSipgateWebhooks } from './endpoints/sipgate.webhooks'
import { registerTranslations } from './plugin/registerTranslations'
import { buildSyncCallHistoryTask } from './tasks/syncCallHistoryTask'
import type { SipgateCredentials } from './types'
import { createCallActivityWidget } from './widgets/callActivity.widget'
import { createLiveCallFloatingWindow } from './widgets/liveCallFloatingWindow.component'

export type SipgatePluginOptions = {
	/**
	 * Whether to disable the plugin.
	 */
	disabled?: boolean

	/**
	 * Your collections with phone number fields.
	 */
	contactCollections: CollectionSlug[]

	/**
	 * These field slugs will be used to identify phoneNumber fields on your contact collections.
	 */
	phoneNumberFields: string[]

	/**
	 * Whether to sync call logs from the Sipgate API.
	 */
	syncCallLogs: boolean

	/**
	 * The credentials to use for the Sipgate API.
	 */
	sipgateCredentials: SipgateCredentials

	/**
	 * Whether to enable the call activity widget.
	 */
	enableCallActivityWidget: boolean // TODO: Implement the widget and inject. This needs payload v3.65.0 or higher. (TODO: confirm version, could also be 3.64.0)

	/**
	 * Whether to enable the live call floating window.
	 */
	enableLiveCallFloatingWindow: boolean

	/**
	 * The overrides to use for the plugin.
	 */
	overrides?: {
		callLogs?: Partial<CollectionConfig>
		allActivityWidget?: Partial<Widget> // TODO: See above.
		sipgateWebhooks?: Partial<Endpoint>
		sipgateActiveCall?: Partial<Endpoint>
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

		// 1. Inject custom Call Logs collection
		const callLogsSlug = 'call-logs'
		config.collections?.push(
			createCallLogsCollection(options.contactCollections, options.overrides?.callLogs)
		)

		if (options.syncCallLogs) {
			if (!config.jobs) config.jobs = {}
			if (!config.jobs.tasks) config.jobs.tasks = []
			config.jobs.tasks.push(buildSyncCallHistoryTask({ callLogsSlug }))
		}

		// 2. Extend target contact collections with custom UI components

		// 3. Inject custom API endpoints for the Sipgate Webhook
		config.endpoints?.push(
			createSipgateWebhooks(
				options.contactCollections,
				options.phoneNumberFields,
				options.overrides?.sipgateWebhooks
			),
			createSipgateActiveCall(options.overrides?.sipgateActiveCall)
		)

		// 4. Inject global Admin UI components for call notifications
		if (options.enableLiveCallFloatingWindow) {
			config.admin?.components?.beforeNav?.push(
				createLiveCallFloatingWindow(options.overrides?.liveCallFloatingWindow)
			)
		}

		// 5. Inject custom dashboard widget for call activity
		if (options.enableCallActivityWidget) {
			config.admin?.dashboard?.widgets?.push(
				createCallActivityWidget(options.overrides?.allActivityWidget)
			)
		}
		return config
	},
})

export type { SipgatePluginOptions as PluginOptions }
