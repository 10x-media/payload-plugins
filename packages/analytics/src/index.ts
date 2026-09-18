import { type Config, definePlugin, type PayloadRequest } from 'payload'

import { proxyEndpoints } from './capture/proxyEndpoint'
import { trackerEndpoint } from './capture/trackerEndpoint'
import { type AnalyticsPluginOptions, resolveOptions } from './core/options'
import { createRegistry, staticRegistryResolver } from './core/registry'
import { buildGoalsCollection } from './goals/collection'
import { GOALS_PATH, makeGoalsHandler } from './goals/goalsEndpoint'
import { configGoalsResolver, createGoalsResolver } from './goals/resolver'
import { trackServerEvent } from './native/ingest/serverTrack'
import { DOCUMENT_PATH, makeDocumentHandler } from './plugin/documentEndpoint'
import { isModuleNotFoundError } from './plugin/peerImportError'
import { makeQueryHandler, QUERY_PATH } from './plugin/queryEndpoint'
import { makeRealtimeHandler, REALTIME_PATH } from './plugin/realtimeEndpoint'
import { makeRefreshHandler, REFRESH_PATH } from './plugin/refreshEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { setRuntime } from './plugin/runtime'
import type { ScopeChange } from './plugin/scopeChange'
import { validateScopeField } from './plugin/scopeFieldBoot'
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
import { createEpochStore } from './surfacing/epoch'
import { syncCollection } from './sync/collection'
import { syncTask } from './sync/syncTask'
import { DEFAULT_TIMEZONE, isValidTimeZone } from './timeframe/tz'
import { registerView } from './view/registerView'
import { registerWidgets } from './widgets/registerWidgets'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/analytics': AnalyticsPluginOptions
	}
}

/** How long a collection write waits on its cache epoch bumps, however many scopes they cover. */
const EPOCH_BUMP_DEADLINE_MS = 2_000

/**
 * Settles with `work`, or rejects once `ms` has passed. A KV that hangs rather than failing
 * would otherwise hold an editor's save open for as long as it hangs; the race keeps a
 * handler on `work`, so a rejection arriving after the deadline stays handled.
 */
const withDeadline = async (work: Promise<unknown>, ms: number): Promise<void> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
	})
	try {
		await Promise.race([work, deadline])
	} finally {
		clearTimeout(timer)
	}
}

export const analytics = definePlugin<AnalyticsPluginOptions>({
	slug: '@10x-media/analytics',
	plugin: async ({ config, plugins: _plugins, ...options }): Promise<Config> => {
		if (options.disabled === true) {
			return config
		}
		const resolved = resolveOptions(options)
		// A tenant's own runtime adapter (providers.collection or providers.resolve) has
		// capabilities unknown at config time, so it opens the widget/endpoint gates that
		// otherwise key off the config-adapter capability union.
		const providersEnabled =
			resolved.providers.collection.enabled || Boolean(resolved.providers.resolve)
		const defaultLayout = config.admin?.dashboard?.defaultLayout
		registerTranslations(config, options.translations)
		const registry = createRegistry(resolved.adapters, resolved.defaultAdapter)
		const registryBase = { adapters: resolved.adapters, defaultId: resolved.defaultAdapter }
		let resolveRegistry = staticRegistryResolver(registry)
		let invalidateProviders = () => {}
		/**
		 * Retires the cached reads of every scope a collection write touched. Bound at init,
		 * where the epoch store exists; goals defined in plugin config cannot change at
		 * runtime, so only the collections ever bump. A bump that fails or outlives its
		 * deadline is logged and swallowed: an unreachable token store must never fail or
		 * stall an editor's save.
		 */
		let bumpScopes: (change: ScopeChange) => Promise<void> = async () => {}
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
				onChange: (change) => {
					invalidateProviders()
					return bumpScopes(change)
				},
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
		// Config goals are install-wide; the collection resolves per scope and merges over
		// them behind the same signature, so ingest and the tracker config read one source.
		const goalsResolver = resolved.goalsCollection.enabled
			? createGoalsResolver({
					slug: resolved.goalsCollection.slug,
					scopeField: resolved.goalsCollection.scopeField,
					scoped: resolved.scoped,
					config: resolved.goals,
				})
			: configGoalsResolver(resolved.goals)
		if (resolved.goalsCollection.enabled) {
			config.collections = [
				...(config.collections ?? []),
				buildGoalsCollection({
					slug: resolved.goalsCollection.slug,
					access: resolved.goalsCollection.access,
					overrides: resolved.goalsCollection.overrides,
					onChange: (change) => {
						goalsResolver.invalidate()
						return bumpScopes(change)
					},
					scoped: resolved.scoped,
					scopeField: resolved.goalsCollection.scopeField,
					resolveScope,
					platformRead: resolved.access.platformRead,
				}),
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
			adapter.register?.(config, {
				scoped: resolved.scoped,
				resolveScope,
				resolveTimezone,
				resolveGoals: goalsResolver.resolve,
			})
		}
		if (
			resolved.adapters.some((a) => a.capabilities.realtime && typeof a.realtime === 'function') ||
			providersEnabled
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
			{ method: 'get', path: GOALS_PATH, handler: makeGoalsHandler() },
			{ method: 'get', path: QUERY_PATH, handler: makeQueryHandler() },
			{ method: 'post', path: REFRESH_PATH, handler: makeRefreshHandler() },
		]
		// A runtime provider's capture support is unknown at config time, so providers
		// alone are enough to mount the proxy; every slot is still resolved per request.
		if (resolved.adapters.some((a) => a.capture) || providersEnabled) {
			config.endpoints = [...config.endpoints, ...proxyEndpoints(), trackerEndpoint()]
		}
		if (resolved.widgets.enabled) {
			const multiProvider = registry.isMultiProvider() || providersEnabled
			registerWidgets(config, {
				adapters: resolved.adapters,
				multiProvider,
				providersEnabled,
				disabled: resolved.widgets.disabled,
				register: resolved.widgets.register,
				localizeText: resolved.widgets.localizeText,
				defaultId: resolved.defaultAdapter,
				comparison: resolved.widgets.comparison,
				view:
					resolved.view === false
						? false
						: {
								path: resolved.view.path,
								defaultRange: resolved.view.defaultRange,
								defaultMetric: resolved.view.defaultMetric,
							},
			})
		}
		registerView(config, { view: resolved.view, pluginOptions: options })
		if (resolved.cache.warm.enabled) {
			config.jobs = {
				...config.jobs,
				tasks: [
					...(config.jobs?.tasks ?? []),
					warmTask(resolved.cache.warm.cron, defaultLayout, resolved.scopes),
				],
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
						scopes: resolved.scopes,
					}),
				],
			}
		}
		const prevOnInit = config.onInit
		// The runtime is installed before the app's own onInit runs so consumer init code
		// (seeding, cache warming, sync passes) can already read through the plugin.
		config.onInit = async (payload) => {
			// Host-owned scope fields only exist once every plugin has run, so the collections
			// are checked against the assembled config rather than at config time.
			if (resolved.scoped && resolved.goalsCollection.enabled) {
				validateScopeField(payload, {
					option: 'goals.collection.scopeField',
					slug: resolved.goalsCollection.slug,
					scopeField: resolved.goalsCollection.scopeField,
				})
			}
			if (resolved.scoped && resolved.providers.collection.enabled) {
				validateScopeField(payload, {
					option: 'providers.collection.scopeField',
					slug: resolved.providers.collection.slug,
					scopeField: resolved.providers.collection.scopeField,
				})
			}
			if (resolved.providers.collection.enabled) {
				const { validateEncryptedBoot } = await import('@10x-media/fields/encrypted')
				await validateEncryptedBoot(payload, resolved.providers.collection.encryption?.keys)
			}
			const epoch = createEpochStore(payload)
			bumpScopes = async (change) => {
				const scopes = new Set<string | null>([change.scope])
				if (change.previousScope !== undefined) {
					scopes.add(change.previousScope)
				}
				const bumps = [...scopes].map(async (scope) => {
					try {
						await epoch.bump(scope)
					} catch (err) {
						payload.logger?.warn(
							`analytics: cache epoch bump failed for scope "${scope ?? 'global'}", cached reads stay until their ttl: ${String(err)}`
						)
					}
				})
				// One deadline covers every scope a save touches: a document moving between two
				// of them must not be able to hold the write open for one deadline each.
				try {
					await withDeadline(Promise.allSettled(bumps), EPOCH_BUMP_DEADLINE_MS)
				} catch (err) {
					const named = [...scopes].map((scope) => `"${scope ?? 'global'}"`).join(', ')
					payload.logger?.warn(
						`analytics: cache epoch bump did not settle for ${named}, cached reads stay until their ttl: ${String(err)}`
					)
				}
			}
			const engine = createEngine({
				store: kvCacheStore(payload.kv),
				queue: { concurrency: 4 },
				ttl: resolved.cache.ttl,
				timeoutMs: resolved.cache.timeoutMs,
				epoch,
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
				captureSlots: resolved.capture.slots,
				capturePaths: resolved.capture.paths,
				captureProxy: resolved.capture.proxy,
				consentFor: resolved.capture.consent,
				autoCapture: resolved.capture.autoCapture,
				goals: resolved.goals,
				resolveGoals: goalsResolver.resolve,
				resolveGoalsDetailed: goalsResolver.resolveDetailed,
				...(resolved.goalsCollection.enabled
					? { goalsCollectionSlug: resolved.goalsCollection.slug }
					: {}),
				ingestPath: resolved.adapters.find((a) => a.ingest)?.ingest?.path,
				track: (event, opts) => trackServerEvent(payload, event, opts),
				scoped: resolved.scoped,
				configAdapterIds: new Set(resolved.adapters.map((a) => a.id)),
				platformRead: resolved.access.platformRead,
				readAccess: resolved.access.read,
				bindings: resolved.bindings,
				engine,
				epoch,
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
	AnalyticsCaptureOptions,
	AnalyticsGoalsCollectionOptions,
	AnalyticsGoalsOptions,
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
	AnalyticsReadAccess,
	AnalyticsViewAccess,
	AnalyticsViewOptions,
	AutoCaptureOptions,
	CaptureConsentOption,
	ConsentMode,
	ConsentResolver,
	PlatformReadAccess,
	ProvidersCollectionOptions,
	ProvidersOptions,
	ProvidersResolve,
	ScopeResolver,
	ScopesResolver,
	TimezoneResolver,
} from './core/options'
export type { ServerEventInput, ServerTrack, ServerTrackOptions } from './core/serverEvent'
export { AnalyticsTrackError } from './core/serverEvent'
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
export type { GoalFieldOptions } from './goals/goalField'
export { goalField, goalSlug } from './goals/goalField'
export type { GoalsResponse, WireGoal } from './goals/goalsEndpoint'
export type {
	GoalActionDefinition,
	GoalActionRunArgs,
	TrackGoalActionOptions,
} from './goals/trackGoalAction'
export { GOAL_ACTION_TYPE, trackGoalAction } from './goals/trackGoalAction'
export type { Goal, GoalMatch, TrackerGoal } from './goals/types'
export { trackServerEvent } from './native/ingest/serverTrack'
export type { QueryError, QueryErrorCode } from './query/errors'
export type {
	QueryErrorResponse,
	QueryResponse,
	QuerySourceRef,
	SerializedAnalyticsQuery,
} from './query/response'
export type { TimeframePreset } from './timeframe/presets'
export type { CustomWidgetDef } from './widgets/customWidget'
export { analyticsDefaultWidgets } from './widgets/defaults'
export { widgetFilters } from './widgets/filterField'
export type { WidgetFilter } from './widgets/types'
