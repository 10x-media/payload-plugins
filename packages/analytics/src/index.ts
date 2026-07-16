import { type Config, definePlugin, type PayloadRequest } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry, staticRegistryResolver } from './core/registry'
import { makeRealtimeHandler, REALTIME_PATH } from './plugin/realtimeEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { setRuntime } from './plugin/runtime'
import { warmTask } from './plugin/warmTask'
import { buildProvidersCollection } from './providers/collection'
import {
	collectionProvidersSource,
	combineRegistries,
	createScopedRegistryResolver,
} from './providers/resolver'
import { kvCacheStore } from './surfacing/cacheStore'
import { createEngine } from './surfacing/engine'
import { syncCollection } from './sync/collection'
import { syncTask } from './sync/syncTask'
import { DEFAULT_TIMEZONE, isValidTimeZone } from './timeframe/tz'
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
		const registryBase = { adapters: resolved.adapters, defaultId: resolved.defaultAdapter }
		let resolveRegistry = staticRegistryResolver(registry)
		let invalidateProviders = () => {}
		const providersResolve = resolved.providers.resolve
		if (providersResolve) {
			resolveRegistry = async (args) =>
				combineRegistries(
					registryBase,
					await providersResolve({ payload: args.payload, req: args.req, scope: args.scope })
				)
		} else if (resolved.providers.collection.enabled) {
			const scoped = createScopedRegistryResolver({
				base: registryBase,
				source: collectionProvidersSource(
					resolved.providers.collection.slug,
					resolved.providers.collection.scopeField
				),
			})
			resolveRegistry = scoped.resolver
			invalidateProviders = scoped.invalidate
		}
		if (resolved.providers.collection.enabled) {
			config.collections = [
				...(config.collections ?? []),
				buildProvidersCollection({
					slug: resolved.providers.collection.slug,
					access: resolved.providers.collection.access,
					overrides: resolved.providers.collection.overrides,
					onChange: () => invalidateProviders(),
				}),
			]
		}
		const resolveScope = async (req: PayloadRequest) => resolved.scopeResolver({ req })
		const resolveTimezone = async (req: PayloadRequest, scope?: string | null): Promise<string> => {
			const opt = resolved.reportingTimezone
			if (opt === undefined) {
				return DEFAULT_TIMEZONE
			}
			try {
				const tz =
					typeof opt === 'string'
						? opt
						: await opt({ req, scope: scope !== undefined ? scope : await resolveScope(req) })
				return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE
			} catch (err) {
				req.payload?.logger?.warn?.(
					`analytics: reportingTimezone resolution failed, falling back to UTC: ${String(err)}`
				)
				return DEFAULT_TIMEZONE
			}
		}
		for (const adapter of resolved.adapters) {
			adapter.register?.(config, { scoped: resolved.scoped, resolveScope, resolveTimezone })
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
				resolveRegistry,
				resolveScope,
				resolveTimezone,
				platformAdapterId: resolved.platformAdapter,
				platformRead: resolved.access.platformRead,
				bindings: resolved.bindings,
				engine,
				ttl: resolved.cache.ttl,
				comparison: resolved.widgets.comparison,
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
export { PLATFORM_SCOPE } from './core/contract'
export type {
	AnalyticsAccessOptions,
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
	PlatformReadAccess,
	ProvidersCollectionOptions,
	ProvidersOptions,
	ProvidersResolve,
	ScopeResolver,
	TimezoneResolver,
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
