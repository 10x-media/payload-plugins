import { type Config, definePlugin, type Endpoint, type PayloadRequest } from 'payload'

import { itemCollectionsOf } from './binding/report'
import { captureRequest } from './capture/captureRequest'
import { makeExclusionHandler } from './capture/exclusionEndpoint'
import { proxyEndpoints } from './capture/proxyEndpoint'
import { trackerEndpoint } from './capture/trackerEndpoint'
import { assertMaintainRegistered, TASK_SLUGS } from './core/jobs'
import {
	type AnalyticsPluginOptions,
	adapterCountsWithoutConsent,
	resolveOptions,
	type ScopeCallSite,
} from './core/options'
import { createRegistry, withoutRevenue } from './core/registry'
import { CURRENCY_PATTERN } from './goals/currency'
import { makeGoalsHandler } from './goals/goalsEndpoint'
import { applyConfigRevenueVisibility } from './goals/moneyFields'
import { configGoalsResolver } from './goals/resolver'
import type { Goal } from './goals/types'
import { addComponentDependency, FLAG_DEPENDENCY } from './plugin/adminDependencies'
import { expectedCollections } from './plugin/collectionChecks'
import { createRuntimeFactory } from './plugin/createRuntime'
import { makeDocumentHandler } from './plugin/documentEndpoint'
import { makeFlagsHandler } from './plugin/flagsEndpoint'
import { restrictJobControls } from './plugin/jobsAccess'
import {
	addStateCollection,
	type CollectionContext,
	cacheCollectionOf,
	configCollections,
	syncCollectionOf,
} from './plugin/pluginCollections'
import { makeQueryHandler } from './plugin/queryEndpoint'
import { makeRealtimeHandler } from './plugin/realtimeEndpoint'
import { makeRefreshHandler } from './plugin/refreshEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { relabelFactoryFields } from './plugin/relabelFields'
import { assertRoutesReachable } from './plugin/routeChecks'
import {
	ANALYTICS_CONFIG_KEY,
	type AnalyticsAdminCustom,
	pluginEndpoint,
	routePaths,
} from './plugin/routes'
import { getRuntime, resolveGoalsFor, resolveRegistryFor, runtimeFactoryOf } from './plugin/runtime'
import { addTask, schemaOnly } from './plugin/schemaOnly'
import { changedScopes, type ScopeChange } from './plugin/scopeChange'
import { makeSourcesHandler } from './plugin/sourcesEndpoint'
import { fillUnbundledLanguages, unbundledLanguages } from './plugin/unbundledLanguages'
import { warmTask } from './plugin/warmTask'
import { syncTask } from './sync/syncTask'
import { createStrictTimezoneResolver, createTimezoneResolver } from './timeframe/reportingTimezone'
import { keys } from './translations/keys'
import { createStaticLabels } from './translations/staticLabel'
import { registerView } from './view/registerView'
import { registerWidgets } from './widgets/registerWidgets'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/analytics': AnalyticsPluginOptions
	}
}

/**
 * Rereads the scopes a providers or goals save touched, on the instance that wrote; every other
 * instance catches up through its own probe.
 */
const configChanged =
	(collection: 'providers' | 'goals') =>
	(change: ScopeChange, req: PayloadRequest): void => {
		getRuntime(req.payload)?.configChanged?.(collection, changedScopes(change))
	}

const addEndpoints = (config: Config, ...endpoints: Endpoint[]): void => {
	config.endpoints = [...(config.endpoints ?? []), ...endpoints]
}

export const analytics = definePlugin<AnalyticsPluginOptions>({
	slug: '@10x-media/analytics',
	plugin: async ({ config, plugins: _plugins, ...options }): Promise<Config> => {
		const disabled = options.disabled === true
		// Switched off, nothing reads through the adapters: they are only asked for their schema.
		const resolved = resolveOptions(options, { requireAdapters: !disabled })
		const resolveScope = async (req: PayloadRequest, callSite: ScopeCallSite) =>
			resolved.scope.resolve({ req, callSite })
		const resolveAdminScope = (req: PayloadRequest) => resolveScope(req, 'admin')
		// What the collection checks warn about waits for the instance's logger, at init.
		const notices: string[] = []
		// Read before the plugin merges its own strings in, so the app's own still win.
		const staticLabel = createStaticLabels({
			app: config.i18n?.translations,
			plugin: options.translations,
			unbundled: unbundledLanguages(config),
		})
		const context: CollectionContext = {
			db: config.db?.name,
			notice: (message) => {
				notices.push(message)
			},
			staticLabel,
		}
		const collections = await configCollections(
			resolved,
			{ resolveAdminScope, onChange: configChanged },
			context
		)
		const sync = syncCollectionOf(resolved, resolveAdminScope, context)
		if (disabled) {
			return schemaOnly(config, {
				resolved,
				collections,
				context,
				...(sync ? { sync } : {}),
				...(options.translations ? { translations: options.translations } : {}),
			})
		}
		const routes = routePaths(resolved.routes.base)
		// Whatever is mounted before the plugin runs belongs to the host or an earlier plugin.
		const earlierEndpoints = new Set(config.endpoints ?? [])
		const money = resolved.revenue.enabled
		// A runtime provider's capabilities are unknown at config time, so providers open the
		// widget and endpoint gates that otherwise follow the config adapters' capabilities.
		const providersEnabled =
			resolved.providers.collection.enabled || Boolean(resolved.providers.resolve)
		// Read before the adapters register: only a host that turned it on may carry concurrency keys.
		const jobsConcurrency = config.jobs?.enableConcurrencyControl === true
		registerTranslations(config, options.translations)
		fillUnbundledLanguages(config)
		const registry = createRegistry(resolved.adapters, resolved.defaultAdapter)
		// Adapters ask for a scope to stamp a visitor's hit with, so theirs is the capture call
		// site, asked without the signed-in user or their cookies.
		const resolveCaptureScope = (req: PayloadRequest) =>
			resolveScope(captureRequest(req), 'capture')
		/**
		 * Whether a scope's own committed provider documents grant it this adapter (a beacon decrypts
		 * nothing). Handed to adapters only when `scope.resolve` and the providers collection both run.
		 */
		const adapterGrantedForScope = async (
			req: PayloadRequest,
			scope: string | null,
			adapterId: string
		): Promise<boolean> => {
			const runtime = getRuntime(req.payload)
			if (!runtime) {
				return true
			}
			if (runtime.providerGranted) {
				return runtime.providerGranted(scope, adapterId)
			}
			const { grants } = await resolveRegistryFor(runtime, { payload: req.payload, req, scope })
			return grants.has(adapterId)
		}
		const configGoals = configGoalsResolver(resolved.goals, resolved.purchaseGoal)
		/** The goals of the instance a request reached, which adapters resolve at ingest. */
		const resolveGoals = (req: PayloadRequest, scope?: string | null): Promise<Goal[]> => {
			const runtime = getRuntime(req.payload)
			return runtime ? resolveGoalsFor(runtime, req, scope) : configGoals.resolve(req, scope)
		}
		config.collections = [...(config.collections ?? []), ...collections]
		const timezoneArgs = { option: resolved.reportingTimezone, resolveScope: resolveAdminScope }
		const resolveTimezone = createTimezoneResolver(timezoneArgs)
		const resolveTimezoneStrict = createStrictTimezoneResolver(timezoneArgs)
		const resolveCurrency = async (
			req: PayloadRequest,
			scope?: string | null
		): Promise<string | undefined> => {
			const opt = resolved.revenue.currency
			if (opt === undefined) {
				return undefined
			}
			try {
				const code =
					typeof opt === 'string'
						? opt
						: await opt({ req, scope: scope !== undefined ? scope : await resolveAdminScope(req) })
				return code && CURRENCY_PATTERN.test(code) ? code : undefined
			} catch (err) {
				req.payload?.logger?.warn?.(
					`analytics: revenue.currency resolution failed, reporting revenue unformatted: ${String(err)}`
				)
				return undefined
			}
		}
		const itemCollections = itemCollectionsOf(resolved.bindings)
		for (const adapter of resolved.adapters) {
			adapter.register?.(config, {
				scoped: resolved.scoped,
				resolveScope: resolveCaptureScope,
				resolveTimezone,
				resolveTimezoneStrict,
				revenue: {
					enabled: money,
					dimension: resolved.revenue.dimension,
					currency: resolveCurrency,
					convert: resolved.revenue.convert,
					browserAmounts: resolved.revenue.browserAmounts,
					orderSignature: resolved.revenue.orderSignature,
				},
				resolveGoals,
				...(resolved.scoped && resolved.providers.collection.enabled
					? { adapterGrantedForScope }
					: {}),
				trustedProxyHops: resolved.trustedProxyHops,
				trustedPlatform: resolved.trustedPlatform,
				allowedOrigins: resolved.capture.allowedOrigins,
				adapterCountsWithoutConsent: adapterCountsWithoutConsent(resolved, adapter),
				...(itemCollections.size > 0
					? {
							items: {
								collections: itemCollections,
								pages: resolved.capture.autoCapture.items.pages,
							},
						}
					: {}),
				routes,
				sdks: resolved.sdks,
				jobs: resolved.jobs,
				jobsConcurrency,
				notice: context.notice,
			})
		}
		assertMaintainRegistered(
			resolved.jobs,
			(config.jobs?.tasks ?? []).some((task) => task.slug === TASK_SLUGS.maintain)
		)
		// After registration: an adapter declares what the install measures once it is registered,
		// and one that declares no revenue then is read as it is rather than as a copy.
		const readRegistry = money ? registry : withoutRevenue(registry)
		if (
			resolved.adapters.some((a) => a.capabilities.realtime && typeof a.realtime === 'function') ||
			providersEnabled
		) {
			addEndpoints(config, { method: 'get', path: routes.live, handler: makeRealtimeHandler() })
		}
		if (Object.keys(resolved.bindings).length > 0) {
			addEndpoints(config, { method: 'get', path: routes.document, handler: makeDocumentHandler() })
		}
		addEndpoints(
			config,
			{ method: 'get', path: routes.sources, handler: makeSourcesHandler() },
			{ method: 'get', path: routes.goals, handler: makeGoalsHandler() },
			{ method: 'get', path: routes.query, handler: makeQueryHandler() },
			{ method: 'post', path: routes.refresh, handler: makeRefreshHandler() }
		)
		if (resolved.capture.exclusion) {
			addEndpoints(config, {
				method: 'get',
				path: routes.exclusion,
				handler: makeExclusionHandler(),
			})
		}
		// One answer serves the view, the widgets and the route, so the flags an install draws and
		// the route serving them cannot diverge. A host's own flag needs no route, only the import map.
		const countryFlags = resolved.countryFlags
		if (countryFlags === true) {
			addEndpoints(config, {
				method: 'get',
				path: routes.flagsPattern,
				handler: makeFlagsHandler(),
			})
		} else if (countryFlags !== false) {
			addComponentDependency(config, FLAG_DEPENDENCY, countryFlags.Component)
		}
		// A runtime provider's capture support is unknown at config time, so providers
		// alone are enough to mount the proxy; every slot is still resolved per request.
		if (resolved.adapters.some((a) => a.capture) || providersEnabled) {
			addEndpoints(config, ...proxyEndpoints(routes), trackerEndpoint(routes))
		}
		if (resolved.widgets.enabled) {
			const multiProvider = registry.isMultiProvider() || providersEnabled
			registerWidgets(config, {
				adapters: resolved.adapters,
				multiProvider,
				providersEnabled,
				revenue: money,
				disabled: resolved.widgets.disabled,
				register: resolved.widgets.register,
				localizeText: resolved.widgets.localizeText,
				defaultId: resolved.defaultAdapter,
				comparison: resolved.widgets.comparison,
				countryFlags,
				staticLabel,
				overrides: resolved.widgets.overrides,
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
		registerView(config, { view: resolved.view, title: staticLabel(keys.viewTitle) })
		const { jobs } = resolved
		if (jobs !== false && resolved.cache.warm.enabled) {
			addTask(
				config,
				warmTask({
					schedule: jobs.warm,
					windowHours: resolved.cache.warm.windowHours,
					maxReads: resolved.cache.warm.maxReads,
					concurrency: jobsConcurrency,
				})
			)
		}
		if (sync) {
			config.collections = [...(config.collections ?? []), sync]
			if (jobs !== false) {
				addTask(
					config,
					syncTask({
						schedule: jobs.sync,
						lookbackDays: resolved.sync.lookbackDays,
						collectionSlug: resolved.sync.collection.slug,
						adapterIds: resolved.sync.adapters,
						scopes: resolved.scope.list,
						concurrency: jobsConcurrency,
					})
				)
			}
		}
		const cache = cacheCollectionOf(resolved, context)
		if (cache) {
			config.collections = [...(config.collections ?? []), cache]
		}
		addStateCollection(config, resolved, context)
		restrictJobControls(config)
		// Hidden per config rather than per process, so two instances answer for themselves; a later
		// plugin's fields (form-builder's action blocks) take their factory's own `revenue` option.
		applyConfigRevenueVisibility(config, money)
		relabelFactoryFields(config, staticLabel)
		config.endpoints = (config.endpoints ?? []).map((endpoint) =>
			earlierEndpoints.has(endpoint) ? endpoint : pluginEndpoint(endpoint)
		)
		// Checked against everything registered so far, the plugin's own collections included; what a
		// later plugin adds is caught when a runtime is built from the assembled config.
		assertRoutesReachable(resolved.routes.base, {
			collections: config.collections ?? [],
			endpoints: config.endpoints,
		})
		const factory = createRuntimeFactory({
			resolved,
			notices,
			collections: expectedCollections(config.collections),
			registry: readRegistry,
			resolveScope,
			resolveTimezone,
			resolveCurrency,
		})
		const adminCustom: AnalyticsAdminCustom = { routes: { base: resolved.routes.base } }
		config.custom = { ...config.custom, [ANALYTICS_CONFIG_KEY]: factory }
		config.admin = {
			...config.admin,
			custom: { ...config.admin?.custom, [ANALYTICS_CONFIG_KEY]: adminCustom },
		}
		const prevOnInit = config.onInit
		// Validation only: the runtime builds on first use either way, and is built here so consumer
		// init code (seeding, cache warming, sync passes) runs against a warm one.
		config.onInit = async (payload) => {
			// Without the factory every endpoint answers 503; a boot error names the cause instead.
			if (runtimeFactoryOf(payload.config) !== factory) {
				throw new Error(RUNTIME_FACTORY_LOST)
			}
			await factory.validate(payload)
			getRuntime(payload)
			await prevOnInit?.(payload)
		}
		return config
	},
})

/** Said at boot when a step after the plugin dropped its runtime from `config.custom`. */
const RUNTIME_FACTORY_LOST = `analytics: config.custom["${ANALYTICS_CONFIG_KEY}"] no longer holds the analytics runtime: a plugin or config step that runs after analytics replaced config.custom instead of spreading it. Spread the existing value there ({ ...config.custom, ... }), or list analytics after that plugin.`

export { isAdminUser } from './access/adminUser'
export { type TenantMembershipOptions, tenantMembership } from './access/membership'
export { type GatedScope, type ReadPrincipal, SYSTEM } from './access/principal'
export { ProviderHttpError, parseRetryAfter } from './adapters/http/fetchJson'
export type { ReportMode, ReportOption } from './binding/report'
export type {
	AnalyticsBinding,
	BindingContext,
	BindingDoc,
	HostnameResolver,
	PathResolver,
} from './binding/types'
export type { CapabilityRequirement, FilterPair, SerializedCapabilities } from './core/capabilities'
export {
	type AnalyticsQuery,
	type AnalyticsResult,
	PLATFORM_SCOPE,
} from './core/contract'
export type {
	AnalyticsAccessOptions,
	AnalyticsCacheCollectionOptions,
	AnalyticsCacheOptions,
	AnalyticsCaptureOptions,
	AnalyticsCollectionOptions,
	AnalyticsComponent,
	AnalyticsConcurrencyOptions,
	AnalyticsCountryFlags,
	AnalyticsCrossScopeOptions,
	AnalyticsExclusionOptions,
	AnalyticsGoalsCollectionOptions,
	AnalyticsGoalsOptions,
	AnalyticsHooksOptions,
	AnalyticsJobsOptions,
	AnalyticsPluginOptions,
	AnalyticsPluginOptions as PluginOptions,
	AnalyticsReadAccess,
	AnalyticsRevenueOptions,
	AnalyticsRoutesOptions,
	AnalyticsScopeOptions,
	AnalyticsSourceOptions,
	AnalyticsSyncCollectionOptions,
	AnalyticsSyncOptions,
	AnalyticsTaskOptions,
	AnalyticsViewAccess,
	AnalyticsViewOptions,
	AnalyticsWarmOptions,
	AnalyticsWidgetOverride,
	AnalyticsWidgetOverrides,
	AnalyticsWidgetsOptions,
	AutoCaptureOptions,
	CaptureGate,
	CaptureGateArgs,
	CaptureSlotOption,
	CollectionOverrides,
	CrossScopeAccess,
	CurrencyConverter,
	CurrencyResolver,
	DefaultSourceFunction,
	DefaultSourceRule,
	ExclusionSitesResolver,
	ItemCaptureOptions,
	OwnSource,
	ProviderHostsOptions,
	ProvidersCollectionOptions,
	ProvidersOptions,
	ProvidersResolve,
	ProvidersResolveArgs,
	ScopeCallSite,
	ScopeLabelResolver,
	ScopeListResolver,
	ScopeMemberAccess,
	ScopeResolver,
	SourcePolicy,
	SourcePolicyFunction,
	SourceRef,
	TimezoneResolver,
	WithoutConsentArgs,
	WithoutConsentFunction,
	WithoutConsentOption,
} from './core/options'
export type {
	AnalyticsSdks,
	Ga4Client,
	Ga4ClientOptions,
	Ga4ReportResponse,
	Ga4ReportRow,
	Ga4Sdk,
	MaxmindReader,
	MaxmindSdk,
} from './core/sdks'
export type {
	ServerEventInput,
	ServerTrack,
	ServerTrackIdentity,
	ServerTrackOptions,
} from './core/serverEvent'
export { AnalyticsTrackError } from './core/serverEvent'
export { BUILT_IN_WIDGET_SLUGS, type BuiltInWidgetSlug } from './core/widgetSlugs'
export type * from './exports/adapters/contract'
export type { AnalyticsAttributes } from './exports/attributes'
export type {
	AnalyticsFieldsOptions,
	AnalyticsMetricLabel,
	AnalyticsMetricLabels,
	AnalyticsStatBaseOptions,
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
export type {
	FieldBreakdown,
	FieldBreakdownRow,
	FieldReadResult,
	FieldReadStatus,
	ReadForFieldArgs,
} from './fields/readForDocument'
export { readForField } from './fields/readForDocument'
export type {
	GoalCollectionFieldOverrides,
	GoalFieldOverride,
} from './goals/collection'
export { GOALS_SLUG } from './goals/collection'
export {
	CURRENCY_ATTRIBUTE,
	EVENT_ATTRIBUTE,
	EVENT_PROP_PREFIX,
	GOAL_ATTRIBUTE,
	ITEM_ATTRIBUTE,
	ITEM_CLICK_EVENT,
	ITEM_NAME_ATTRIBUTE,
	MAX_ITEMS_PER_BEACON,
	PURCHASE_GOAL_SLUG,
	VALUE_ATTRIBUTE,
} from './goals/constants'
export type { GoalFieldOptions } from './goals/goalField'
export { goalField, goalSlug } from './goals/goalField'
export type { GoalsResponse, WireGoal } from './goals/goalsEndpoint'
export type { AnalyticsLinkFieldsOptions } from './goals/linkFields'
export { analyticsLinkFields } from './goals/linkFields'
export type { BrowserAmounts, OrderSignatureMode } from './goals/match'
export type { GoalSource } from './goals/resolver'
export type {
	PurchaseInput as ServerPurchaseInput,
	RefundInput as ServerRefundInput,
} from './goals/serverRevenue'
export { purchase, refund } from './goals/serverRevenue'
export type {
	GoalActionDefinition,
	GoalActionRunArgs,
	TrackGoalActionOptions,
} from './goals/trackGoalAction'
export { GOAL_ACTION_TYPE, trackGoalAction } from './goals/trackGoalAction'
export type { Goal } from './goals/types'
export { STATE_SLUG } from './native/collections/slugs'
export type { RebuildDaysInput, RebuildDaysReport } from './native/engine/rebuild'
export {
	type ItemSignatureMode,
	itemAttributesFor,
	signItemRef,
} from './native/ingest/itemSignature'
export { signOrderId } from './native/ingest/orderSignature'
export { trackServerEvent } from './native/ingest/serverTrack'
export { rebuildDays } from './native/rebuildDays'
export {
	createGuardedFetch,
	type GuardedFetch,
	type GuardedFetchOptions,
} from './net/guardedFetch'
export type { TrustedPlatform } from './net/platform'
export type { CollectionFieldOverride } from './plugin/collectionFields'
export {
	ANALYTICS_ERROR_CODES,
	type AnalyticsError,
	type AnalyticsErrorCode,
	analyticsError,
	readErrorCode,
} from './plugin/errors'
export type { RoutesConfigSource } from './plugin/routes'
export {
	analyticsRoutes,
	DEFAULT_ROUTE_BASE,
	type RouteBase,
	type RoutePaths,
	routePaths,
} from './plugin/routes'
export type {
	BuildSecretField,
	ConnectionAccess,
	ConnectionFieldAccess,
	ProviderCollectionFieldOverrides,
	ProviderFieldOverride,
	ProviderFieldsOptions,
} from './providers/collection'
export { analyticsProviderFields, PROVIDERS_SLUG } from './providers/collection'
export type { ProviderDoc, ProviderFactoryContext, ProviderId } from './providers/factory'
export { adapterFromProviderDoc, PROVIDER_IDS } from './providers/factory'
export type { HostPattern } from './providers/hosts'
export { type ProviderHostPolicy, resolveHostPolicy } from './providers/hosts'
export { type RefreshProvidersOptions, refreshProviders } from './providers/refresh'
export { CONNECTION_PATHS, SECRET_PATHS } from './providers/secrets'
export type { QueryError, QueryErrorCode } from './query/errors'
export type {
	ItemLabels,
	QueryErrorResponse,
	QueryResponse,
	QuerySourceRef,
	SerializedAnalyticsQuery,
} from './query/response'
export type {
	AfterReadAnswer,
	AfterReadArgs,
	AfterReadHook,
	ReadOrigin,
} from './surfacing/afterRead'
export { CACHE_SLUG } from './surfacing/cacheCollection'
export type {
	CacheEntry,
	CacheSetOptions,
	CacheStore,
	ReadRecipe,
	RecipeWindow,
} from './surfacing/cacheStore'
export { SYNC_SLUG } from './sync/collection'
export { TIMEFRAME_PRESETS, type TimeframePreset } from './timeframe/presets'
export type { GoalMatch, RevenueItem, TrackerGoal } from './tracker/config'
export type { TranslationsOption } from './translations'
export {
	keys,
	type PluralCategory,
	type PluralName,
	type PluralVariant,
	pluralKeys,
	type SingularKey,
	type TranslationKey,
} from './translations/keys'
export type { CustomWidgetDef } from './widgets/customWidget'
export {
	type AnalyticsDefaultLayoutOptions,
	analyticsDefaultLayout,
} from './widgets/defaultLayout'
export { analyticsDefaultWidgets } from './widgets/defaults'
export { widgetFilters } from './widgets/filterField'
export type { StoredSourceRead, SubstitutedSource } from './widgets/prepareWidgetRead'
export type {
	ReadForWidgetArgs,
	WidgetReadResult,
	WidgetReadStatus,
} from './widgets/readForWidget'
export { readForWidget } from './widgets/readForWidget'
export type {
	BreakdownRow,
	ReadForWidgetBreakdownArgs,
	WidgetBreakdownResult,
} from './widgets/readForWidgetBreakdown'
export { readForWidgetBreakdown } from './widgets/readForWidgetBreakdown'
export type {
	GoalRow,
	ReadForWidgetGoalsArgs,
	WidgetGoalsResult,
} from './widgets/readForWidgetGoals'
export { readForWidgetGoals } from './widgets/readForWidgetGoals'
export type {
	ReadForWidgetRealtimeArgs,
	RealtimePoint,
	WidgetRealtimeResult,
	WidgetRealtimeStatus,
} from './widgets/readForWidgetRealtime'
export { readForWidgetRealtime } from './widgets/readForWidgetRealtime'
export type {
	ReadForWidgetSeriesArgs,
	SeriesGranularity,
	SeriesPoint,
	WidgetSeriesResult,
} from './widgets/readForWidgetSeries'
export { readForWidgetSeries } from './widgets/readForWidgetSeries'
export type { ReadNotices } from './widgets/readMeta'
export type { WidgetFilter } from './widgets/types'
