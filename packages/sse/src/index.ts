import { type Config, definePlugin } from 'payload'

import { resolveSSEOptions, type SSEPluginOptions } from './options'
import { registerSSE } from './plugin/registerSSE'
import { registerTranslations } from './plugin/registerTranslations'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/sse': SSEPluginOptions
	}
}

/**
 * SSE plugin for Payload v3. Registers collection hooks, the realtime stream
 * endpoint, and a per-payload runtime exposed via `getSSE`.
 * Runs after collection-adding plugins (`order: 90`) so it can patch their
 * collections; before automations (`order: 100`).
 */
export const sse = definePlugin<SSEPluginOptions>({
	slug: '@10x-media/sse',
	order: 90,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const resolved = resolveSSEOptions(options)
		registerTranslations(config, resolved.translations)
		registerSSE({ config, options: resolved })
		return config
	},
})

export type { EventBroker, RealtimeEvent, SSEOperation, ThinRealtimeEvent } from './broker/types'
export { SSE_SKIP } from './hooks/createAfterChangeHook'
export type {
	AdminOptions,
	CollectionSSEConfig,
	LiveListAdminOptions,
	PresenceIdentify,
	PresenceOptions,
	ResolvedAdminOptions,
	ResolvedPresenceOptions,
	SSEPluginOptions,
	SSEPluginOptions as PluginOptions,
	SSEScopeOptions,
} from './options'
export { getSSE } from './plugin/runtime'
export { PRESENCE_PATH } from './presence/makePresenceHandler'
export type { MultiTenantScopeOptions } from './scope/multiTenantScope'
export { multiTenantScope } from './scope/multiTenantScope'
export { publicTopic, scopedTopic } from './scope/resolveScope'
export type { ResolveDocScope, ResolveRequestScope, ScopeSelection } from './scope/types'
export { SCOPE_WILDCARD } from './scope/types'
export { STREAM_PATH } from './stream/makeStreamHandler'
