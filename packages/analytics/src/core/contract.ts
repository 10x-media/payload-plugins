import type { Config, PayloadRequest } from 'payload'

/**
 * Explicit cross-scope read marker: pass as a read's `scope` to aggregate over every
 * scope. Gated by `access.platformRead`; the query reaches the adapter unscoped.
 */
export const PLATFORM_SCOPE = '*'

export type MetricKey =
	| 'pageviews'
	| 'visitors'
	| 'visits'
	| 'sessions'
	| 'bounceRate'
	| 'avgDuration'
	| 'scrollDepth'
	| 'events'
	| 'conversions'
	| 'revenue'

export type DimensionKey =
	| 'page'
	| 'referrer'
	| 'source'
	| 'medium'
	| 'campaign'
	| 'utmSource'
	| 'utmMedium'
	| 'utmCampaign'
	| 'utmContent'
	| 'utmTerm'
	| 'device'
	| 'browser'
	| 'os'
	| 'country'
	| 'region'
	| 'city'
	| 'language'
	| 'event'

export type Granularity = 'minute' | 'hour' | 'day' | 'week' | 'month'

export interface DateRange {
	start: Date
	end: Date
}

export interface AnalyticsFilter {
	dimension: DimensionKey
	operator: 'eq' | 'contains' | 'matches'
	value: string
}

export interface AnalyticsQuery {
	path?: string
	hostname?: string
	metrics: MetricKey[]
	dimensions?: DimensionKey[]
	dateRange: DateRange
	granularity?: Granularity
	filters?: AnalyticsFilter[]
	limit?: number
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
	/**
	 * Analytics boundary this read belongs to (tenant id, site key). Undefined means
	 * install-wide (the default). Adapters that can filter by scope apply it; others
	 * ignore it. Always part of the surfacing cache key, so per-scope adapter
	 * instances sharing an id never share cached results.
	 */
	scope?: string
}

export interface AnalyticsRow {
	dimensions?: Partial<Record<DimensionKey, string>>
	metrics: Partial<Record<MetricKey, number>>
	timestamp?: string
}

export interface AnalyticsResult {
	rows: AnalyticsRow[]
	totals?: Partial<Record<MetricKey, number>>
	meta: { provider: string; sampled?: boolean; clamped?: boolean; fetchedAt: string }
}

export interface RateLimitDescriptor {
	requestsPerMinute?: number
	requestsPerHour?: number
	maxConcurrent?: number
	quotaModel?: 'requests' | 'tokens'
	readsCountAsUsage?: boolean
}

export interface AnalyticsCapabilities {
	perPageQuery: boolean
	realtime: boolean
	realtimeWindowMinutes?: number
	comparison: boolean
	minGranularity: Granularity
	maxLookbackDays: number | null
	metrics: ReadonlySet<MetricKey>
	dimensions: ReadonlySet<DimensionKey>
	batchPageReport: boolean
	rateLimit: RateLimitDescriptor | null
	recommendedTtl: { realtime: number; aggregate: number }
	/**
	 * The adapter applies `AnalyticsQuery.scope` as a provider-native filter (native
	 * scope column, PostHog `scopeProperty`, ...). Without it, a scoped read through
	 * a shared platform adapter would expose cross-scope data, so such reads are
	 * gated by `access.platformRead`.
	 */
	scopedQueries?: boolean
}

export interface AdapterContext {
	signal?: AbortSignal
}

/** Extra context the plugin hands adapters when they register config surface. */
export interface AdapterRegisterContext {
	/** True when the plugin has a scopeResolver configured. */
	scoped: boolean
	/** The plugin's scopeResolver bound for adapter use (e.g. ingest stamping). */
	resolveScope: (req: PayloadRequest) => Promise<string | null>
}

export interface AnalyticsAdapter {
	readonly id: string
	readonly label: string
	readonly capabilities: AnalyticsCapabilities
	isConfigured(): boolean
	query(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	realtime?(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	register?(config: Config, context?: AdapterRegisterContext): void
}

export type AnalyticsAdapterFactory<Config> = (config: Config) => AnalyticsAdapter
