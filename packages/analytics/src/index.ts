import { type Config, definePlugin } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry } from './core/registry'
import { makeRealtimeHandler, REALTIME_PATH } from './plugin/realtimeEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { setRuntime } from './plugin/runtime'
import { warmTask } from './plugin/warmTask'
import { kvCacheStore } from './surfacing/cacheStore'
import { createEngine } from './surfacing/engine'
import { syncCollection } from './sync/collection'
import { syncTask } from './sync/syncTask'
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
		const defaultLayout = config.admin?.dashboard?.defaultLayout
		registerTranslations(config, options.translations)
		const registry = createRegistry(resolved.adapters, resolved.defaultAdapter)
		for (const adapter of resolved.adapters) {
			adapter.register?.(config)
		}
		if (
			resolved.adapters.some((a) => a.capabilities.realtime && typeof a.realtime === 'function')
		) {
			config.endpoints = [
				...(config.endpoints ?? []),
				{ method: 'get', path: REALTIME_PATH, handler: makeRealtimeHandler() },
			]
		}
		if (resolved.widgets.enabled) {
			registerWidgets(config, {
				adapters: resolved.adapters,
				multiProvider: registry.isMultiProvider(),
				disabled: resolved.widgets.disabled,
				register: resolved.widgets.register,
				localizeText: resolved.widgets.localizeText,
			})
		}
		if (resolved.cache.warm.enabled) {
			config.jobs = {
				...config.jobs,
				tasks: [...(config.jobs?.tasks ?? []), warmTask(resolved.cache.warm.cron, defaultLayout)],
			}
		}
		if (resolved.sync.enabled) {
			config.collections = [
				...(config.collections ?? []),
				syncCollection(resolved.sync.collectionSlug),
			]
			config.jobs = {
				...config.jobs,
				tasks: [
					...(config.jobs?.tasks ?? []),
					syncTask({
						cron: resolved.sync.cron,
						lookbackDays: resolved.sync.lookbackDays,
						collectionSlug: resolved.sync.collectionSlug,
						adapterIds: resolved.sync.adapters,
					}),
				],
			}
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
	AnalyticsMetricLabel,
	AnalyticsMetricLabels,
	AnalyticsStatOptions,
	AnalyticsStatRowOptions,
	AnalyticsTabOptions,
} from './fields/factories'
export {
	analyticsFields,
	analyticsStat,
	analyticsStatRow,
	analyticsTab,
	analyticsTabsField,
} from './fields/factories'
export type { TimeframePreset } from './timeframe/presets'
export type { CustomWidgetDef } from './widgets/customWidget'
export { analyticsDefaultWidgets } from './widgets/defaults'
