import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import type { AnalyticsBinding, ResolvedBinding } from '../binding/types'
import { PROVIDERS_SLUG } from '../providers/collection'
import type { TranslationsOption } from '../translations'
import type { CustomWidgetDef } from '../widgets/customWidget'
import type { AnalyticsAdapter } from './contract'

const DEFAULT_WARM_CRON = '*/30 * * * *'
const DEFAULT_SYNC_CRON = '0 */6 * * *'
const DEFAULT_SYNC_COLLECTION = 'analytics-daily'
const DEFAULT_SYNC_LOOKBACK = 3
const DEFAULT_SCOPE_FIELD = 'scope'

/**
 * Maps a request to its analytics boundary (tenant id, site key). Null means the
 * whole install, which is the default single-site behavior. With a multi-tenant
 * plugin, return the request's tenant id here.
 */
export type ScopeResolver = (args: {
	req: PayloadRequest
}) => string | null | Promise<string | null>

/**
 * Resolves the IANA reporting timezone a read's (or ingest's) day boundaries align
 * to. Receives the request and its already-resolved scope, so per-tenant, per-user
 * (`req.user`), and selector (cookie/preference) strategies are all expressible.
 * Return `null` to fall back to UTC.
 */
export type TimezoneResolver = (args: {
	req: PayloadRequest
	scope: string | null
}) => string | null | Promise<string | null>

/**
 * Escape hatch replacing the provider-collection lookup: return the runtime
 * adapters for a scope yourself (any store, any shape). Results are layered onto
 * the static config adapters exactly like collection-resolved ones, but are not
 * cached; memoize inside the function if lookups are expensive.
 */
export type ProvidersResolve = (args: {
	payload: Payload
	req?: PayloadRequest
	scope: string | null
}) => AnalyticsAdapter[] | Promise<AnalyticsAdapter[]>

export type ProvidersCollectionOptions = {
	slug?: string
	/**
	 * Field matched against the resolved scope when looking up a scope's providers.
	 * Point it at a tenant plugin's field (e.g. 'tenant') when that plugin manages
	 * scoping for the collection.
	 */
	scopeField?: string
	overrides?: (collection: CollectionConfig) => CollectionConfig
	access?: Partial<CollectionConfig['access']>
}

export type ProvidersOptions = {
	/** Opt-in admin collection storing runtime provider configurations. */
	collection?: boolean | ProvidersCollectionOptions
	resolve?: ProvidersResolve
}

/** Access checker for cross-scope (platform) analytics reads. */
export type PlatformReadAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export type AnalyticsAccessOptions = {
	/**
	 * Gates cross-scope reads: explicit `scope: '*'` reads, and scoped reads through
	 * a platform adapter that cannot filter by scope. Defaults to any authenticated
	 * admin-panel user.
	 */
	platformRead?: PlatformReadAccess
}

export type AnalyticsPluginOptions = {
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/analytics/i18n`. Values win over
	 * the built-in locales key-by-key; locales the plugin does not ship are added
	 * whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	adapters?: AnalyticsAdapter[]
	defaultAdapter?: string
	scopeResolver?: ScopeResolver
	/**
	 * IANA reporting timezone that day boundaries (timeframe windows, series axes,
	 * native rollup buckets) align to. Defaults to UTC. A string forces one timezone
	 * (the single-tenant / no-multi-tenancy case); a resolver derives it per request
	 * from the scope, user, or a selector. Native rollups bucket at ingest in the
	 * resolved timezone, so changing it does not re-bucket existing history.
	 */
	reportingTimezone?: string | TimezoneResolver
	providers?: ProvidersOptions
	/**
	 * Id of one config adapter shared by every scope (the platform's own analytics,
	 * e.g. a PostHog project capturing all tenants). Included in each scope's
	 * registry like any config adapter; reads through it are scope-filtered only
	 * when the adapter supports scoped queries, otherwise they are cross-scope and
	 * require `access.platformRead`.
	 */
	platformAdapter?: string
	access?: AnalyticsAccessOptions
	/**
	 * Per-collection bindings, keyed by collection slug. With generated types
	 * augmented, each slug's resolvers receive that collection's typed document.
	 */
	collections?: { [TSlug in CollectionSlug]?: AnalyticsBinding<TSlug> }
	cache?: { ttl?: { aggregate?: number; realtime?: number }; warm?: boolean | { cron?: string } }
	widgets?:
		| boolean
		| {
				disabled?: string[]
				register?: CustomWidgetDef[]
				/**
				 * Marks the free-text widget config fields (each widget's Title) as
				 * `localized`. Off by default; takes effect only when the Payload config
				 * enables localization (Payload strips the flag otherwise).
				 */
				localizeText?: boolean
				/**
				 * Period-over-period comparison on the metric and trend widgets. On by
				 * default for adapters that declare `capabilities.comparison`; set false
				 * to skip the second (previous-window) read entirely.
				 */
				comparison?: boolean
		  }
	/**
	 * Opt-in sync tier: a cron job that persists each provider's daily metrics into a
	 * queryable collection. Reads go through the surfacing cache, so persisted rows reflect
	 * cached values up to `cache.ttl.aggregate` old; keep that TTL below the sync interval
	 * for the freshest data.
	 */
	sync?:
		| boolean
		| { collectionSlug?: CollectionSlug; cron?: string; lookbackDays?: number; adapters?: string[] }
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	scopeResolver: ScopeResolver
	/** True when the app configured a scopeResolver (scoped install). */
	scoped: boolean
	/** Raw reportingTimezone option; normalized into a resolver at init. */
	reportingTimezone?: string | TimezoneResolver
	platformAdapter?: string
	access: { platformRead: PlatformReadAccess }
	providers: {
		collection: {
			enabled: boolean
			slug: string
			scopeField: string
			overrides?: (collection: CollectionConfig) => CollectionConfig
			access?: Partial<CollectionConfig['access']>
		}
		resolve?: ProvidersResolve
	}
	bindings: Record<string, ResolvedBinding>
	cache: {
		/** Undefined when unset: adapter recommendedTtl is the fallback, an explicit value wins. */
		ttl: { aggregate?: number; realtime?: number }
		warm: { enabled: boolean; cron: string }
	}
	widgets: {
		enabled: boolean
		disabled: string[]
		register: CustomWidgetDef[]
		localizeText: boolean
		comparison: boolean
	}
	sync: {
		enabled: boolean
		collectionSlug: string
		cron: string
		lookbackDays: number
		adapters?: string[]
	}
}

const resolveBindings = (
	collections: AnalyticsPluginOptions['collections']
): Record<string, ResolvedBinding> => {
	const out: Record<string, ResolvedBinding> = {}
	for (const [slug, binding] of Object.entries(collections ?? {})) {
		if (!binding) continue
		if (!binding.path && !binding.pathField) {
			throw new Error(`analytics: binding for "${slug}" needs a path resolver or a pathField`)
		}
		// Erases the per-slug doc generic; safe because the runtime only ever hands
		// a binding documents from its own collection.
		out[slug] = binding as ResolvedBinding
	}
	return out
}

export function resolveOptions(options: AnalyticsPluginOptions): ResolvedOptions {
	if (!options.adapters || options.adapters.length === 0) {
		throw new Error('analytics: at least one adapter is required')
	}
	if (
		options.platformAdapter !== undefined &&
		!options.adapters.some((a) => a.id === options.platformAdapter)
	) {
		throw new Error(`analytics: unknown platform adapter "${options.platformAdapter}"`)
	}
	const widgets =
		options.widgets === false
			? {
					enabled: false,
					disabled: [] as string[],
					register: [] as CustomWidgetDef[],
					localizeText: false,
					comparison: true,
				}
			: options.widgets === undefined || options.widgets === true
				? {
						enabled: true,
						disabled: [] as string[],
						register: [] as CustomWidgetDef[],
						localizeText: false,
						comparison: true,
					}
				: {
						enabled: true,
						disabled: options.widgets.disabled ?? [],
						register: options.widgets.register ?? [],
						localizeText: options.widgets.localizeText ?? false,
						comparison: options.widgets.comparison ?? true,
					}
	const warmOpt = options.cache?.warm
	const warm =
		warmOpt === true
			? { enabled: true, cron: DEFAULT_WARM_CRON }
			: warmOpt && typeof warmOpt === 'object'
				? { enabled: true, cron: warmOpt.cron ?? DEFAULT_WARM_CRON }
				: { enabled: false, cron: DEFAULT_WARM_CRON }
	const collectionOpt = options.providers?.collection
	const providers = {
		collection:
			collectionOpt === true
				? { enabled: true, slug: PROVIDERS_SLUG, scopeField: DEFAULT_SCOPE_FIELD }
				: collectionOpt && typeof collectionOpt === 'object'
					? {
							enabled: true,
							slug: collectionOpt.slug ?? PROVIDERS_SLUG,
							scopeField: collectionOpt.scopeField ?? DEFAULT_SCOPE_FIELD,
							overrides: collectionOpt.overrides,
							access: collectionOpt.access,
						}
					: { enabled: false, slug: PROVIDERS_SLUG, scopeField: DEFAULT_SCOPE_FIELD },
		resolve: options.providers?.resolve,
	}
	const syncOpt = options.sync
	const sync =
		syncOpt === true
			? {
					enabled: true,
					collectionSlug: DEFAULT_SYNC_COLLECTION,
					cron: DEFAULT_SYNC_CRON,
					lookbackDays: DEFAULT_SYNC_LOOKBACK,
				}
			: syncOpt && typeof syncOpt === 'object'
				? {
						enabled: true,
						collectionSlug: syncOpt.collectionSlug ?? DEFAULT_SYNC_COLLECTION,
						cron: syncOpt.cron ?? DEFAULT_SYNC_CRON,
						lookbackDays: syncOpt.lookbackDays ?? DEFAULT_SYNC_LOOKBACK,
						adapters: syncOpt.adapters,
					}
				: {
						enabled: false,
						collectionSlug: DEFAULT_SYNC_COLLECTION,
						cron: DEFAULT_SYNC_CRON,
						lookbackDays: DEFAULT_SYNC_LOOKBACK,
					}
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		scopeResolver: options.scopeResolver ?? (() => null),
		scoped: options.scopeResolver !== undefined,
		reportingTimezone: options.reportingTimezone,
		platformAdapter: options.platformAdapter,
		access: { platformRead: options.access?.platformRead ?? (({ req }) => Boolean(req.user)) },
		providers,
		bindings: resolveBindings(options.collections),
		cache: {
			// Left undefined when the app did not set them so the adapter's recommendedTtl
			// applies as the default; an explicit value overrides the adapter recommendation.
			ttl: {
				aggregate: options.cache?.ttl?.aggregate,
				realtime: options.cache?.ttl?.realtime,
			},
			warm,
		},
		widgets,
		sync,
	}
}
