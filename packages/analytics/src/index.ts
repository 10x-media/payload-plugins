import { type Config, definePlugin, type PayloadRequest } from 'payload'

import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry, staticRegistryResolver } from './core/registry'
import { DOCUMENT_PATH, makeDocumentHandler } from './plugin/documentEndpoint'
import { isModuleNotFoundError } from './plugin/peerImportError'
import { makeRealtimeHandler, REALTIME_PATH } from './plugin/realtimeEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { setRuntime } from './plugin/runtime'
import { makeSourcesHandler, SOURCES_PATH } from './plugin/sourcesEndpoint'
import { warmTask } from './plugin/warmTask'
import type { BuildSecretField } from './providers/collection'
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
	plugin: async ({ config, plugins: _plugins, ...options }): Promise<Config> => {
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
		const resolveScope = async (req: PayloadRequest) => resolved.scopeResolver({ req })
		if (resolved.providers.collection.enabled) {
			const { encryptedField, withEncryptedQueryRewrite } = await import(
				'@10x-media/fields/encrypted'
			).catch((err: unknown) => {
				if (isModuleNotFoundError(err)) {
					throw new Error(
						'analytics: providers.collection requires @10x-media/fields (peer). Install it: pnpm add @10x-media/fields'
					)
				}
				throw err
			})
			const encryption = resolved.providers.collection.encryption
			const buildSecret: BuildSecretField = (source) =>
				encryptedField(source, {
					protection: 'writeOnly',
					aadScope: '10x-analytics:providers',
					...(source.type === 'text' ? { hint: { suffix: 4 } } : {}),
					...(encryption?.keys ? { keys: encryption.keys } : {}),
				})
			const providersCollection = buildProvidersCollection({
				slug: resolved.providers.collection.slug,
				access: resolved.providers.collection.access,
				overrides: resolved.providers.collection.overrides,
				onChange: () => invalidateProviders(),
				scoped: resolved.scoped,
				scopeField: resolved.providers.collection.scopeField,
				resolveScope,
				platformRead: resolved.access.platformRead,
				buildSecret,
			})
			// Always wrap, even though a consumer's own @10x-media/fields plugin (if
			// registered) may wrap this collection again later: double application is
			// inert here (writeOnly forbids queryable, so there are no blind-index
			// markers to rewrite and the response strip is an idempotent delete),
			// while skipping would leak ciphertext whenever fields() runs before this
			// collection exists (e.g. an earlier plugin `order`).
			config.collections = [
				...(config.collections ?? []),
				withEncryptedQueryRewrite(providersCollection),
			]
		}
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
		if (Object.keys(resolved.bindings).length > 0) {
			config.endpoints = [
				...(config.endpoints ?? []),
				{ method: 'get', path: DOCUMENT_PATH, handler: makeDocumentHandler() },
			]
		}
		config.endpoints = [
			...(config.endpoints ?? []),
			{ method: 'get', path: SOURCES_PATH, handler: makeSourcesHandler() },
		]
		if (resolved.widgets.enabled) {
			const multiProvider =
				registry.isMultiProvider() ||
				resolved.providers.collection.enabled ||
				Boolean(resolved.providers.resolve)
			registerWidgets(config, {
				adapters: resolved.adapters,
				multiProvider,
				disabled: resolved.widgets.disabled,
				register: resolved.widgets.register,
				localizeText: resolved.widgets.localizeText,
				defaultId: resolved.defaultAdapter,
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
				syncCollection(resolved.sync.collectionSlug, resolved.sync.hidden, {
					scoped: resolved.scoped,
					scopeField: 'scope',
					resolveScope,
					platformRead: resolved.access.platformRead,
				}),
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
		// The runtime is installed before the app's own onInit runs so consumer init code
		// (seeding, cache warming, sync passes) can already read through the plugin.
		config.onInit = async (payload) => {
			if (resolved.providers.collection.enabled) {
				const { validateEncryptedBoot } = await import('@10x-media/fields/encrypted')
				await validateEncryptedBoot(payload, resolved.providers.collection.encryption?.keys)
			}
			const engine = createEngine({
				store: kvCacheStore(payload.kv),
				queue: { concurrency: 4 },
				ttl: resolved.cache.ttl,
				timeoutMs: resolved.cache.timeoutMs,
				onError: (err, adapterId) => {
					payload.logger?.warn(`analytics: read failed for adapter "${adapterId}": ${String(err)}`)
				},
			})
			setRuntime(payload, {
				registry,
				resolveRegistry,
				resolveScope,
				resolveTimezone,
				platformAdapterId: resolved.platformAdapter,
				configAdapterIds: new Set(resolved.adapters.map((a) => a.id)),
				platformRead: resolved.access.platformRead,
				bindings: resolved.bindings,
				engine,
				ttl: resolved.cache.ttl,
				comparison: resolved.widgets.comparison,
			})
			await prevOnInit?.(payload)
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
