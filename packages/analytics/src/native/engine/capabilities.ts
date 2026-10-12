import type {
	AnalyticsCapabilities,
	DimensionKey,
	FilterOperatorMap,
	MetricKey,
} from '../../core/contract'

const BASE_METRICS: readonly MetricKey[] = [
	'pageviews',
	'visitors',
	'sessions',
	'bounceRate',
	'avgDuration',
	'visitDuration',
	'scrollDepth',
	'events',
	'conversions',
]

const BASE_DIMENSIONS: readonly DimensionKey[] = [
	'page',
	'referrer',
	'source',
	'channel',
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
]

/**
 * How long native's answer for a window reaching into today stays fresh: its reads cost the
 * database, not a vendor's quota, so new traffic shows up within seconds rather than minutes.
 */
const NATIVE_TODAY_TTL_SECONDS = 10

/** The raw retention the engine keeps by default, which filtered and hourly reads reach back to. */
export const DEFAULT_RAW_DAYS = 90

interface NativeCapabilityArgs {
	/** The store's own `features.filters`: what its raw reads apply, per dimension. */
	filters: FilterOperatorMap
	/** Days of raw hits kept; null keeps every one. */
	rawDays: number | null
	scoped: boolean
	/** The install's money settings; absent counts money and offers the currency breakdown. */
	revenue?: { enabled: boolean; dimension: boolean }
	/** The install binds a collection as content items. */
	items: boolean
}

const when = <T>(condition: boolean, values: readonly T[]): readonly T[] =>
	condition ? values : []

/**
 * What the native engine declares: exact weeks and months, 30-minute visits, daily visitors
 * summed, raw reads as far as hits are kept, and its store's operators (no SQLite `matches`).
 */
export const nativeCapabilities = (args: NativeCapabilityArgs): AnalyticsCapabilities => {
	const money = args.revenue?.enabled !== false
	const metrics = [
		...BASE_METRICS,
		...when<MetricKey>(money, ['revenue']),
		...when<MetricKey>(args.items, ['impressions', 'interactions']),
	]
	const dimensions = [
		...BASE_DIMENSIONS,
		...when<DimensionKey>(money && args.revenue?.dimension !== false, ['currency']),
		...when<DimensionKey>(args.items, ['item']),
	]
	const filters: FilterOperatorMap = {}
	for (const dimension of dimensions) {
		const operators = args.filters[dimension]
		if (operators && operators.length > 0) {
			filters[dimension] = operators
		}
	}
	return {
		realtime: true,
		realtimeWindowMinutes: 60,
		minGranularity: 'hour',
		calendarBuckets: true,
		maxLookbackDays: null,
		filterLookbackDays: args.rawDays,
		metrics: new Set(metrics),
		dimensions: new Set(dimensions),
		filters,
		semantics: { visitors: 'sumOfDaily', sessions: 'inactivity30m' },
		rateLimit: null,
		recommendedTtl: { realtime: 10, aggregate: 300, today: NATIVE_TODAY_TTL_SECONDS },
		...(args.items ? { perItemQuery: true } : {}),
		...(args.scoped ? { scopedQueries: true } : {}),
	}
}
