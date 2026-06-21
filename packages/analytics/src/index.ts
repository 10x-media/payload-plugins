import { type Config, definePlugin } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry } from './core/registry'
import { registerTranslations } from './plugin/registerTranslations'
import { setRuntime } from './plugin/runtime'
import { kvCacheStore } from './surfacing/cacheStore'
import { createEngine } from './surfacing/engine'
import { registerWidgets } from './widgets/registerWidgets'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/analytics': AnalyticsPluginOptions
	}
}

export const analytics = definePlugin<AnalyticsPluginOptions>({
	slug: '@10x-media/analytics',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const resolved = resolveOptions(options)
		registerTranslations(config)
		const registry = createRegistry(resolved.adapters, resolved.defaultAdapter)
		for (const adapter of resolved.adapters) {
			adapter.register?.(config)
		}
		if (resolved.widgets.enabled) {
			registerWidgets(config, {
				adapters: resolved.adapters,
				multiProvider: registry.isMultiProvider(),
				disabled: resolved.widgets.disabled,
			})
		}
		const prevOnInit = config.onInit
		config.onInit = async (payload) => {
			await prevOnInit?.(payload)
			const engine = createEngine({
				store: kvCacheStore(payload.kv),
				queue: { concurrency: 4 },
				ttl: resolved.cache.ttl,
			})
			setRuntime(payload, {
				registry,
				bindings: resolved.bindings,
				engine,
				ttl: resolved.cache.ttl,
			})
		}
		return config
	},
})

export type {
	AnalyticsBinding,
	BindingContext,
	HostnameResolver,
	PathResolver,
} from './binding/types'
export type {
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
} from './core/options'
export type {
	AnalyticsFieldsOptions,
	AnalyticsStatOptions,
	AnalyticsStatRowOptions,
	AnalyticsTabOptions,
} from './fields/factories'
export {
	analyticsFields,
	analyticsStat,
	analyticsStatRow,
	analyticsTab,
} from './fields/factories'
export type { TimeframePreset } from './timeframe/presets'
