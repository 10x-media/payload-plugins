import type { KeysConfig } from '@10x-media/fields/encrypted'
import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import type { AnalyticsBinding, ResolvedBinding } from '../binding/types'
import { DEFAULT_PROXY_MAX_BODY_BYTES, DEFAULT_PROXY_TIMEOUT_MS } from '../capture/proxyEndpoint'
import type { CaptureSlot } from '../capture/slots'
import { GOAL_SLUG_PATTERN, type Goal } from '../goals/types'
import { PROVIDERS_SLUG } from '../providers/collection'
import type { TranslationsOption } from '../translations'
import type { CustomWidgetDef } from '../widgets/customWidget'
import type { CaptureClientKind } from './capture'
import type { AnalyticsAdapter } from './contract'

const DEFAULT_WARM_CRON = '*/30 * * * *'
const DEFAULT_SYNC_CRON = '0 */6 * * *'
const DEFAULT_SYNC_COLLECTION = 'analytics-daily'
const DEFAULT_SYNC_LOOKBACK = 3
const DEFAULT_SCOPE_FIELD = 'scope'
const DEFAULT_TIMEOUT_MS = 15_000

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
 * Enumerates the tenant scopes the cron tiers (cache warming, sync) fan out over.
 * Absent, each tier runs once for the install-wide scope.
 */
export type ScopesResolver = (args: { payload: Payload }) => string[] | Promise<string[]>

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
	/**
	 * Dedicated key ring for the stored provider credentials. Unset, the
	 * fields plugin's global `encrypted.keys` applies, and with neither the
	 * ring derives from the Payload secret. Configure a dedicated key for
	 * anything beyond a dev install.
	 */
	encryption?: { keys?: KeysConfig }
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
	 * a shared config adapter that cannot filter by scope. Scoped installs
	 * (`scopeResolver` configured) default to deny; configure it, for example a role
	 * check, so platform admins can read cross-scope and manage every tenant's
	 * providers. Unscoped installs default to any authenticated admin-panel user.
	 */
	platformRead?: PlatformReadAccess
}

export type ConsentMode = 'none' | 'required'

/** Per-slot consent decision, evaluated against the slot's resolved adapter. */
export type ConsentResolver = (args: { slot: CaptureSlot; adapterId: string }) => ConsentMode

/**
 * A bare mode applies to every slot; a resolver decides per request-resolved adapter; the
 * object form maps ids and slots, with an adapter entry winning over a slot entry. Every
 * form overrides the default, which is `none` for the cookieless native tracker and
 * `required` for a vendor's.
 */
export type CaptureConsentOption =
	| ConsentMode
	| ConsentResolver
	| {
			slots?: Partial<Record<CaptureSlot, ConsentMode>>
			/**
			 * Keyed by config adapter id, validated at config time. A runtime provider's id
			 * is unknown then, so cover those with the resolver form instead.
			 */
			adapters?: Record<string, ConsentMode>
	  }

/** The normalized policy the runtime evaluates; `kind` carries the adapter's tracker family. */
export type ConsentPolicy = (
	slot: CaptureSlot,
	adapterId: string,
	kind: CaptureClientKind
) => ConsentMode

export type AutoCaptureOptions = {
	scrollDepth?: boolean
	outboundLinks?: boolean
	fileDownloads?: boolean
	goalAttribute?: boolean
}

export type ResolvedAutoCapture = Required<AutoCaptureOptions>

/** Goals as config: the array form, or the object form 1b grows a collection source on. */
export type AnalyticsGoalsOptions = { defaults?: Goal[] }

export type AnalyticsCaptureOptions = {
	/**
	 * Which adapter fills each capture slot, overriding the defaults: `global` is the
	 * designated `platformAdapter`, or the single config adapter when only one is
	 * configured; `tenant` is the resolved scope's default adapter. A `global` id must
	 * name a config adapter; a `tenant` id may also name a runtime provider instance,
	 * so it is resolved per request rather than validated at config time.
	 */
	slots?: { global?: string; tenant?: string }
	/**
	 * Mount each slot's snippet points at. Defaults to the runtime proxy endpoint
	 * (`<routes.api>/analytics/p/<slot>`); set it when the slot is served through Next
	 * rewrites instead, passing the same path `captureRewrites` was mounted at.
	 */
	paths?: { global?: string; tenant?: string }
	/** Whether a slot's tracker waits for consent. Native defaults to no gate, vendors to one. */
	consent?: CaptureConsentOption
	/** Browser auto-capture listeners, all on by default. */
	autoCapture?: AutoCaptureOptions
	/** Limits for the public runtime capture proxy, separate from the read-path `cache`. */
	proxy?: {
		/**
		 * Deadline for the upstream response headers, in ms. Default 10000. The body
		 * download is not on the clock, so a large tracker bundle streams to completion.
		 */
		timeoutMs?: number
		/**
		 * Largest proxied request body, in bytes. Default 1 MiB, which clears a PostHog
		 * batch carrying session-replay data. Anything larger is refused with 413.
		 */
		maxBodyBytes?: number
	}
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
	 * Enumerates the tenant scopes the cache-warming and sync cron tiers fan out
	 * over, in addition to the install-wide (null) scope every tier already runs.
	 * Unset, those tiers run once for the whole install, same as before.
	 */
	scopes?: ScopesResolver
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
	capture?: AnalyticsCaptureOptions
	/**
	 * Conversion goals the tracker and the native ingest match events against. Slugs must
	 * be unique and kebab-case; only the slug and its match reach the browser.
	 */
	goals?: Goal[] | AnalyticsGoalsOptions
	/**
	 * Per-collection bindings, keyed by collection slug. With generated types
	 * augmented, each slug's resolvers receive that collection's typed document.
	 */
	collections?: { [TSlug in CollectionSlug]?: AnalyticsBinding<TSlug> }
	cache?: {
		ttl?: { aggregate?: number; realtime?: number }
		warm?: boolean | { cron?: string }
		/** Per-read provider timeout in ms, spanning retries and limiter waits. Default 15000. */
		timeoutMs?: number
	}
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
		| {
				collectionSlug?: CollectionSlug
				cron?: string
				lookbackDays?: number
				adapters?: string[]
				/** Surface the analytics-daily collection in the admin nav. Default false (hidden). */
				hidden?: boolean
		  }
}

export interface ResolvedCapture {
	slots: { global?: string; tenant?: string }
	paths: { global?: string; tenant?: string }
	consent: ConsentPolicy
	autoCapture: ResolvedAutoCapture
	proxy: { timeoutMs: number; maxBodyBytes: number }
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	scopeResolver: ScopeResolver
	/** True when the app configured a scopeResolver (scoped install). */
	scoped: boolean
	/** Raw scopes option; undefined runs the cron tiers install-wide only. */
	scopes?: ScopesResolver
	/** Raw reportingTimezone option; normalized into a resolver at init. */
	reportingTimezone?: string | TimezoneResolver
	platformAdapter?: string
	access: { platformRead: PlatformReadAccess }
	capture: ResolvedCapture
	/** Config goals, validated; 1b layers collection-sourced goals on top of these. */
	goals: Goal[]
	providers: {
		collection: {
			enabled: boolean
			slug: string
			scopeField: string
			overrides?: (collection: CollectionConfig) => CollectionConfig
			access?: Partial<CollectionConfig['access']>
			encryption?: { keys?: KeysConfig }
		}
		resolve?: ProvidersResolve
	}
	bindings: Record<string, ResolvedBinding>
	cache: {
		/** Undefined when unset: adapter recommendedTtl is the fallback, an explicit value wins. */
		ttl: { aggregate?: number; realtime?: number }
		warm: { enabled: boolean; cron: string }
		timeoutMs: number
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
		/** True hides the analytics-daily collection from the admin nav (default). */
		hidden: boolean
	}
}

export const DEFAULT_AUTO_CAPTURE: ResolvedAutoCapture = {
	scrollDepth: true,
	outboundLinks: true,
	fileDownloads: true,
	goalAttribute: true,
}

const resolveAutoCapture = (option: AutoCaptureOptions | undefined): ResolvedAutoCapture => ({
	scrollDepth: option?.scrollDepth ?? DEFAULT_AUTO_CAPTURE.scrollDepth,
	outboundLinks: option?.outboundLinks ?? DEFAULT_AUTO_CAPTURE.outboundLinks,
	fileDownloads: option?.fileDownloads ?? DEFAULT_AUTO_CAPTURE.fileDownloads,
	goalAttribute: option?.goalAttribute ?? DEFAULT_AUTO_CAPTURE.goalAttribute,
})

/** Cookieless native capture needs no consent gate; a vendor's tracker does. */
export const defaultConsentFor = (kind: CaptureClientKind): ConsentMode =>
	kind === 'native' ? 'none' : 'required'

const resolveConsent = (
	option: CaptureConsentOption | undefined,
	adapters: AnalyticsAdapter[]
): ConsentPolicy => {
	if (option === 'none' || option === 'required') {
		return () => option
	}
	if (typeof option === 'function') {
		return (slot, adapterId) => option({ slot, adapterId })
	}
	for (const id of Object.keys(option?.adapters ?? {})) {
		if (!adapters.some((a) => a.id === id)) {
			throw new Error(`analytics: unknown consent adapter "${id}"`)
		}
	}
	return (slot, adapterId, kind) =>
		option?.adapters?.[adapterId] ?? option?.slots?.[slot] ?? defaultConsentFor(kind)
}

const resolveGoals = (option: AnalyticsPluginOptions['goals']): Goal[] => {
	const goals = Array.isArray(option) ? option : (option?.defaults ?? [])
	const seen = new Set<string>()
	for (const goal of goals) {
		if (!GOAL_SLUG_PATTERN.test(goal.slug)) {
			throw new Error(`analytics: goal slug "${goal.slug}" must be kebab-case`)
		}
		if (seen.has(goal.slug)) {
			throw new Error(`analytics: duplicate goal slug "${goal.slug}"`)
		}
		seen.add(goal.slug)
	}
	return goals
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
	const globalSlot = options.capture?.slots?.global
	if (globalSlot !== undefined && !options.adapters.some((a) => a.id === globalSlot)) {
		throw new Error(`analytics: unknown global capture slot adapter "${globalSlot}"`)
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
							encryption: collectionOpt.encryption,
						}
					: { enabled: false, slug: PROVIDERS_SLUG, scopeField: DEFAULT_SCOPE_FIELD },
		resolve: options.providers?.resolve,
	}
	if (providers.collection.enabled) {
		if (providers.collection.scopeField.trim() === '') {
			throw new Error('analytics: providers.collection.scopeField must be a non-empty field name')
		}
		if (providers.collection.scopeField.includes('.')) {
			throw new Error(
				'analytics: providers.collection.scopeField must be a top-level field name (no dots); the scope stamp writes it as a flat key'
			)
		}
	}
	const syncOpt = options.sync
	const sync =
		syncOpt === true
			? {
					enabled: true,
					collectionSlug: DEFAULT_SYNC_COLLECTION,
					cron: DEFAULT_SYNC_CRON,
					lookbackDays: DEFAULT_SYNC_LOOKBACK,
					hidden: true,
				}
			: syncOpt && typeof syncOpt === 'object'
				? {
						enabled: true,
						collectionSlug: syncOpt.collectionSlug ?? DEFAULT_SYNC_COLLECTION,
						cron: syncOpt.cron ?? DEFAULT_SYNC_CRON,
						lookbackDays: syncOpt.lookbackDays ?? DEFAULT_SYNC_LOOKBACK,
						adapters: syncOpt.adapters,
						hidden: syncOpt.hidden ?? true,
					}
				: {
						enabled: false,
						collectionSlug: DEFAULT_SYNC_COLLECTION,
						cron: DEFAULT_SYNC_CRON,
						lookbackDays: DEFAULT_SYNC_LOOKBACK,
						hidden: true,
					}
	const scoped = options.scopeResolver !== undefined
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		scopeResolver: options.scopeResolver ?? (() => null),
		scoped,
		scopes: options.scopes,
		reportingTimezone: options.reportingTimezone,
		platformAdapter: options.platformAdapter,
		access: {
			platformRead:
				options.access?.platformRead ?? (scoped ? () => false : ({ req }) => Boolean(req.user)),
		},
		capture: {
			slots: {
				global: options.capture?.slots?.global,
				tenant: options.capture?.slots?.tenant,
			},
			paths: {
				global: options.capture?.paths?.global,
				tenant: options.capture?.paths?.tenant,
			},
			consent: resolveConsent(options.capture?.consent, options.adapters),
			autoCapture: resolveAutoCapture(options.capture?.autoCapture),
			proxy: {
				timeoutMs: options.capture?.proxy?.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS,
				maxBodyBytes: options.capture?.proxy?.maxBodyBytes ?? DEFAULT_PROXY_MAX_BODY_BYTES,
			},
		},
		goals: resolveGoals(options.goals),
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
			timeoutMs: options.cache?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		},
		widgets,
		sync,
	}
}
