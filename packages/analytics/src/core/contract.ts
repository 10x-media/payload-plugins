import type { Config, Payload, PayloadRequest } from 'payload'
import type { CurrencyConverter } from '../goals/currency'
import type { BrowserAmounts, OrderSignatureMode } from '../goals/match'
import type { Goal } from '../goals/types'
import type { TrustedPlatform } from '../net/platform'
import type { RoutePaths } from '../plugin/routes'
import type { CaptureSupport } from './capture'
import type { AdapterJobs } from './jobs'
import type { AnalyticsSdks } from './sdks'
import type { IngestHostnameResolver, ServerTrack } from './serverEvent'

/**
 * Explicit cross-scope read marker: pass as a read's `scope` to aggregate over every
 * scope. Gated by `access.crossScope.aggregate`; the query reaches the adapter unscoped.
 */
export const PLATFORM_SCOPE = '*'

export type { AdapterJobs, AnalyticsTaskName, ScheduledTask } from './jobs'

export type MetricKey =
	| 'pageviews'
	| 'visitors'
	| 'visits'
	| 'sessions'
	| 'bounceRate'
	/** Time on page: engaged time per pageview, an average in milliseconds over the pageviews it is read for. */
	| 'avgDuration'
	/** Time per visit: engaged time per visit, an average in milliseconds over the visits it is read for. */
	| 'visitDuration'
	| 'scrollDepth'
	| 'events'
	| 'conversions'
	| 'revenue'
	/** Times a content item was seen on screen. Counted per item only, never per page or site. */
	| 'impressions'
	/** Clicks on a content item, the first per item and pageview. */
	| 'interactions'

/**
 * One metric's reading. `null` is an average or a share with nothing to average over (no
 * pageviews to time, no scroll reported, no sessions to bounce): no data, not zero.
 */
export type MetricValue = number | null

/** A row's or a read's metrics. A metric the source did not report is absent. */
export type MetricValues = Partial<Record<MetricKey, MetricValue>>

/** Every breakdown key the contract defines, the list request parsers validate against. */
export const DIMENSION_KEYS = [
	'page',
	'referrer',
	'source',
	'channel',
	'medium',
	'campaign',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmContent',
	'utmTerm',
	'device',
	'browser',
	'os',
	'country',
	'region',
	'city',
	'language',
	'event',
	'goal',
	'currency',
	'item',
] as const

export type DimensionKey = (typeof DIMENSION_KEYS)[number]

export type Granularity = 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface DateRange {
	start: Date
	end: Date
}

/** Every filter operator the contract defines, the list request parsers validate against. */
export const FILTER_OPERATORS = ['eq', 'contains', 'matches'] as const

export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export interface AnalyticsFilter {
	dimension: DimensionKey
	operator: FilterOperator
	value: string
}

export interface AnalyticsQuery {
	path?: string
	hostname?: string
	/**
	 * One content item's ref (`<collection>:<id>`): the read answers about that item, wherever
	 * it was shown. Only a source declaring `capabilities.perItemQuery` can serve it.
	 */
	item?: string
	metrics: MetricKey[]
	dimensions?: DimensionKey[]
	dateRange: DateRange
	granularity?: Granularity
	filters?: AnalyticsFilter[]
	limit?: number
	/**
	 * How a breakdown is ranked before `limit` cuts it. The metric belongs in `metrics`: ranked by
	 * one the read did not ask for, rows keep the source's order.
	 */
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
	/**
	 * Analytics boundary of the read (tenant id, site key); undefined means install-wide. Adapters
	 * that can filter by scope apply it, and it is always part of the cache key.
	 */
	scope?: string
	/**
	 * IANA timezone the read's day boundaries align to; undefined means UTC. Adapters that can bucket
	 * in a zone apply it, others report in their account's own.
	 */
	timezone?: string
	/**
	 * The scope's goal slugs, which provider adapters restrict goal rows to (native matches goals
	 * itself). `'unresolved'` marks a failed goal resolver and never shares a healthy cache key.
	 */
	goalSlugs?: string[] | 'unresolved'
}

export interface AnalyticsRow {
	dimensions?: Partial<Record<DimensionKey, string>>
	metrics: MetricValues
	timestamp?: string
	/**
	 * How many observations each average in `metrics` was taken over, which folds days into weeks
	 * exactly. An average without one is weighted by its row's matching count.
	 */
	samples?: Partial<Record<MetricKey, number>>
}

/** How a read's `visitors` were counted. */
export type VisitorCounting = 'distinct' | 'sumOfDaily'

/** Why a stale answer's source needs a look: its settings were refused, or its host is not allowed. */
export type SourceErrorKind = 'misconfigured' | 'host-refused'

export interface AnalyticsResult {
	rows: AnalyticsRow[]
	totals?: MetricValues
	meta: {
		provider: string
		/** The source counted from a sample of its data (GA4 on a large property), so the numbers are estimates. */
		sampled?: boolean
		/** The read covers less than it asked for: from `dataFrom` and up to `dataTo`, where set. */
		clamped?: boolean
		/** ISO instant the data starts at, set with `clamped` when later than the range's start. */
		dataFrom?: string
		/**
		 * ISO instant the data ends at, set with `clamped` when earlier than the range's end: a day
		 * the range cuts lies past raw retention in a scope's own zone.
		 */
		dataTo?: string
		/**
		 * `distinct` counts each person once per number; `sumOfDaily` means some number adds up daily
		 * visitors, so a person who came on two days counts twice.
		 */
		visitorsAre?: VisitorCounting
		/** Some days of the range could not be read yet, so the numbers are a floor. */
		partial?: { missingDays: number }
		/**
		 * On this many days of the range a value the read asks about was folded into the `(other)`
		 * row of its daily totals, and its raw hits are no longer kept: the numbers are a floor.
		 */
		capped?: { days: number }
		/**
		 * On this many days of the range counting failed again and again and was given up: each is
		 * read from an earlier count when it had one, and left out otherwise.
		 */
		failed?: { days: number }
		/**
		 * The scope's reporting timezone could not be resolved and none was ever recorded, so this
		 * read cut its days in UTC and counted nothing for later reads.
		 */
		timezoneUnresolved?: true
		/** ISO instant the numbers were last brought up to date, when older than `fetchedAt`. */
		asOf?: string
		/**
		 * ISO instant the source was read (`ctx.now`), never later than the engine got the answer; a
		 * cached answer keeps it.
		 */
		fetchedAt: string
		/**
		 * ISO 4217 code `revenue` is reported in: the vendor's own, else the install's
		 * `revenue.currency` or the read's `currency` filter. Absent, revenue is a plain sum as sent.
		 */
		currency?: string
		/**
		 * The currencies the read's revenue adds unconverted amounts of, when more than one. Native
		 * sets it.
		 */
		mixedCurrencies?: string[]
		/**
		 * Served from a cache entry past its TTL: at once while a refresh runs, or because the refresh
		 * failed. `asOf` then says when the entry was fetched.
		 */
		stale?: boolean
		/**
		 * Set on a stale answer whose source last failed as set up rather than as an outage:
		 * credentials refused (`misconfigured`) or host not allowed (`host-refused`).
		 */
		sourceError?: SourceErrorKind
		/**
		 * Filters the source could not carry, so the rows are wider than the query asked for.
		 * A provider whose API takes one value per dimension reports the ones it dropped here.
		 */
		unappliedFilters?: AnalyticsFilter[]
		/**
		 * The read's goal numbers are absent because resolving them failed. A scope with no goals gets
		 * an empty result instead, not this flag.
		 */
		goalsUnresolved?: true
	}
}

/**
 * The vendor's limits the source's lane keeps to, one token per upstream request per window. A read
 * with conversions may cost a second, goal-filtered request.
 */
export interface RateLimitDescriptor {
	requestsPerMinute?: number
	requestsPerHour?: number
	/** Upstream requests the source may have in flight; `cache.concurrency.perSource` when unset. */
	maxConcurrent?: number
	/** Whether reads also spend the provider's write or ingest quota. */
	readsCountAsUsage?: boolean
}

/**
 * Which operators each dimension can be filtered with. A dimension absent here, or listed with
 * no operator, cannot be filtered at all.
 */
export type FilterOperatorMap = Partial<Record<DimensionKey, readonly FilterOperator[]>>

/** Where a source reads one metric, when it cannot read it under every breakdown it offers. */
export interface MetricReach {
	/**
	 * The breakdowns the metric is read under; empty when only whole-site numbers carry it.
	 * Absent: every dimension the source declares.
	 */
	dimensions?: readonly DimensionKey[]
	/**
	 * A dimension the read must break down or filter by for the metric to have a value at all.
	 * A read of one page (`AnalyticsQuery.path`) counts as filtering by `page`.
	 */
	requires?: DimensionKey
}

/** What the numbers of a source mean where sources differ. */
export interface MetricSemantics {
	/**
	 * `distinct` counts each person once over a range; `sumOfDaily` adds up each day's visitors.
	 * Either may be per hostname: native's visitor id is, so two hostnames add up.
	 */
	visitors: VisitorCounting
	/** `inactivity30m` ends a visit after 30 minutes without activity; `provider` is the vendor's own rule. */
	sessions: 'inactivity30m' | 'provider'
}

export interface AnalyticsCapabilities {
	/** The source answers `AnalyticsQuery.item`: one content item's views, clicks and outcomes. */
	perItemQuery?: boolean
	realtime: boolean
	realtimeWindowMinutes?: number
	/**
	 * Period-over-period comparison, which the engine serves for every source by reading the
	 * previous window itself. Adapters omit this; set it false only to opt a source out.
	 */
	comparison?: boolean
	minGranularity: Granularity
	/**
	 * The source answers `week` and `month` series itself, exactly. Without it the engine reads
	 * days and folds them into weeks and months in the read's reporting timezone.
	 */
	calendarBuckets?: boolean
	maxLookbackDays: number | null
	/**
	 * How far back a filtered read reaches, when that is shorter than `maxLookbackDays`: the
	 * source narrows a longer one itself and marks it `clamped`. Absent or null: as far as any read.
	 */
	filterLookbackDays?: number | null
	metrics: ReadonlySet<MetricKey>
	dimensions: ReadonlySet<DimensionKey>
	/**
	 * Metrics the source reads only under some breakdowns or only for a page; any other is read under
	 * every dimension. Reads outside a metric's reach are refused and hidden by pickers.
	 */
	metricReach?: Partial<Record<MetricKey, MetricReach>>
	/**
	 * The `AnalyticsQuery.filters` the source applies, per dimension. A read carrying any other
	 * pair is refused before it reaches the adapter. Absent: no filter at all.
	 */
	filters?: FilterOperatorMap
	/** What `visitors` and `sessions` mean here. Absent: not declared. */
	semantics?: MetricSemantics
	rateLimit: RateLimitDescriptor | null
	/**
	 * Seconds an answer stays fresh. `today`, for a source cheap to read again, caps a window that
	 * reaches into the current day whatever `cache.ttl` says; such an answer is never served stale.
	 */
	recommendedTtl: { realtime: number; aggregate: number; today?: number }
	/**
	 * The adapter applies `AnalyticsQuery.scope` as a native filter. Without it a scoped read through
	 * a shared adapter would see other scopes, so it is gated by `access.crossScope.unscopedSource`.
	 */
	scopedQueries?: boolean
	/**
	 * The adapter sends every vendor request through `AdapterContext.upstream`, so each one spends
	 * its own rate token and slot. Without it the engine counts a whole read as one request.
	 */
	upstreamAware?: boolean
}

export interface AdapterContext {
	signal?: AbortSignal
	/**
	 * The Payload instance the read is for, which the surfacing engine always passes. An adapter
	 * that stores its data in Payload's database reads through it.
	 */
	payload?: Payload
	/**
	 * Sends one vendor request through the source's lane: rate token, slot, retries on outage,
	 * circuit breaker. Absent outside the engine, where `fn(ctx.signal)` is called directly.
	 */
	upstream?: <T>(fn: (signal?: AbortSignal) => Promise<T>) => Promise<T>
	/**
	 * Milliseconds the read has left before it gives up, for a vendor SDK that takes a deadline of
	 * its own rather than a signal. Absent outside the engine.
	 */
	remainingMs?: () => number
	/**
	 * What time it is by the plugin's clock (Payload's), which an adapter stamps `meta.fetchedAt`
	 * with. The engine always passes it; absent outside the engine.
	 */
	now?: () => Date
}

/** Extra context the plugin hands adapters when they register config surface. */
export interface AdapterRegisterContext {
	/** True when the plugin has `scope.resolve` configured. */
	scoped: boolean
	/**
	 * `scope.resolve` at the `capture` call site, for ingest stamping: the host's resolver sees no
	 * user, cookies or authorization header, so a hit files under the site it landed on.
	 */
	resolveScope: (req: PayloadRequest) => Promise<string | null>
	/**
	 * The plugin's reportingTimezone bound for adapter use, for what is shown in it. Resolves to
	 * `'UTC'` when no reportingTimezone is set, and when the host's resolver fails.
	 */
	resolveTimezone: (req: PayloadRequest, scope?: string | null) => Promise<string>
	/**
	 * The same timezone, thrown rather than falling back to UTC: for an adapter storing days counted
	 * in it, where recounting a day in UTC would move its numbers.
	 */
	resolveTimezoneStrict: (req: PayloadRequest, scope?: string | null) => Promise<string>
	/** The install's `revenue` settings, for adapters that declare or reconcile revenue. */
	revenue: {
		enabled: boolean
		dimension: boolean
		/** `revenue.currency` bound for adapter use: `undefined` when none is set, revenue a plain number. */
		currency: (req: PayloadRequest, scope?: string | null) => Promise<string | undefined>
		/** `revenue.convert`, for adapters that reconcile revenue at ingest. */
		convert?: CurrencyConverter
		/** `revenue.browserAmounts`, for an adapter that takes amounts from the browser itself. */
		browserAmounts?: BrowserAmounts
		/** `revenue.orderSignature`, for an adapter that takes the browser's order ids. */
		orderSignature?: OrderSignatureMode
	}
	/**
	 * The install's goals for a request's scope (config goals, the collection's merged over them),
	 * for adapters that match completions themselves.
	 */
	resolveGoals: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
	/**
	 * Whether a scope's own provider documents grant it this adapter; present only when the providers
	 * collection runs under `scope.resolve`. Native ingest stores nothing for a scope it denies.
	 */
	adapterGrantedForScope?: (
		req: PayloadRequest,
		scope: string | null,
		adapterId: string
	) => Promise<boolean>
	/** The plugin's `trustedProxyHops`, for adapters that read a request's client address. */
	trustedProxyHops?: number
	/**
	 * The plugin's `trustedPlatform`, for adapters that read a request's client address or
	 * location: the only platform whose edge headers may be believed.
	 */
	trustedPlatform?: TrustedPlatform
	/**
	 * `capture.allowedOrigins`, normalized, for adapters that register a public POST endpoint: the
	 * only other sites whose pages may send to it from a visitor's browser.
	 */
	allowedOrigins?: ReadonlySet<string>
	/**
	 * The collections bound as content items, the only ones whose refs ingest keeps, and whether
	 * an item is also counted per page it appeared on. Absent means no item is bound.
	 */
	items?: { collections: ReadonlySet<string>; pages: boolean }
	/** The plugin's mounts under `routes.api`, for adapters that register an endpoint of their own. */
	routes?: RoutePaths
	/**
	 * The packages the host handed the plugin as `sdks`, for adapters that would otherwise load
	 * them at runtime: GA4's Data API client, the native engine's MaxMind reader.
	 */
	sdks?: AnalyticsSdks
	/**
	 * The plugin's `jobs`: the queue and schedule of the maintenance task an adapter registers, or
	 * false when the install registers no task and the adapter's own requests do that work instead.
	 */
	jobs?: AdapterJobs
	/**
	 * The host's `jobs.enableConcurrencyControl`: only then may a task an adapter registers carry a
	 * concurrency key, which Payload refuses otherwise.
	 */
	jobsConcurrency?: boolean
	/** Says something at init, once the instance can log: what the boot warns about rather than refuses. */
	notice?: (message: string) => void
}

/** What a switched-off install hands an adapter that keeps its schema (`disabled: true`). */
export interface AdapterSchemaContext {
	/** The plugin's `jobs`, which decides whether the adapter's task slug is in the jobs enum. */
	jobs: AdapterJobs
	/** What the boot would warn about, which a switched-off install never says. */
	notice?: (message: string) => void
}

/** Whom a source's label is read for: the request, and the scope its sources were listed for. */
export interface AdapterLabelArgs {
	req: PayloadRequest
	/** Null is install-wide, `*` is cross-scope. */
	scope: string | null
}

export interface AnalyticsAdapter {
	readonly id: string
	/** The source's name wherever no reader is known (boot-time pickers, logs). */
	readonly label: string
	/**
	 * The source's name for one reader, where it differs by language or by who reads. Read through
	 * `sourceLabelFor`, which falls back to `label` when this fails.
	 */
	readonly labelFor?: (args: AdapterLabelArgs) => string | Promise<string>
	readonly capabilities: AnalyticsCapabilities
	/** Browser-tracker proxying/boot descriptor. Absent when no public capture field is set. */
	readonly capture?: CaptureSupport
	/**
	 * Where the adapter's own ingest endpoint listens, relative to `routes.api`, and how server code
	 * reaches that pipeline directly. Server-side only, never serialized.
	 */
	readonly ingest?: { path: string; track?: ServerTrack; hostname?: IngestHostnameResolver }
	isConfigured(): boolean
	query(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	realtime?(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	register?(config: Config, context?: AdapterRegisterContext): void
	/**
	 * For `disabled: true`: adds exactly the schema `register` would (collections, fields, indexes,
	 * task slugs) and nothing that runs, so a switched-off install keeps its tables.
	 */
	registerSchema?(config: Config, context: AdapterSchemaContext): void
	/**
	 * Binds the adapter to the Payload instance a runtime is built for, whenever one is, with or
	 * without `onInit`. Called again for every rebuild, so it must be idempotent per instance.
	 */
	attach?(payload: Payload): void
	/**
	 * Releases what the adapter holds for one instance (buffers, clients, timers) once that
	 * instance's runtime is retired; another instance the adapter serves keeps what it holds.
	 */
	close?(payload: Payload): void | Promise<void>
}

export type AnalyticsAdapterFactory<Config> = (config: Config) => AnalyticsAdapter
