import type { Config } from 'payload'

export type MetricKey =
	| 'pageviews'
	| 'visitors'
	| 'visits'
	| 'sessions'
	| 'bounceRate'
	| 'avgDuration'
	| 'entries'
	| 'exits'
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
}

export interface AnalyticsRow {
	dimensions?: Partial<Record<DimensionKey, string>>
	metrics: Partial<Record<MetricKey, number>>
	timestamp?: string
}

export interface AnalyticsResult {
	rows: AnalyticsRow[]
	totals?: Partial<Record<MetricKey, number>>
	meta: { provider: string; sampled?: boolean; fetchedAt: string }
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
}

export interface AdapterContext {
	signal?: AbortSignal
}

export interface AnalyticsAdapter {
	readonly id: string
	readonly label: string
	readonly capabilities: AnalyticsCapabilities
	isConfigured(): boolean
	query(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	realtime?(query: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult>
	register?(config: Config): void
}

export type AnalyticsAdapterFactory<Config> = (config: Config) => AnalyticsAdapter
