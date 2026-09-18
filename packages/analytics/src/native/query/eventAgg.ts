import type { AnalyticsFilter, AnalyticsRow, DimensionKey, MetricKey } from '../../core/contract'
import { DEFAULT_TIMEZONE, startOfDayInTz } from '../../timeframe/tz'

/**
 * Raw event shape aggregateEvents/filtersToWhere operate on; matches StoredEvent as read back
 * from the events collection (timestamp comes back as an ISO string). Every column the ingest
 * may leave unset is `| null` as well as optional: Postgres reads an unwritten column back as
 * null, Mongo leaves the key off entirely, and both spellings mean "not recorded".
 */
export interface EventLike {
	timestamp: string | Date
	type: 'pageview' | 'event' | 'goal'
	name?: string | null
	path: string
	device?: string | null
	browser?: string | null
	os?: string | null
	source?: string | null
	channel?: string | null
	/** The referrer host derived at ingest; the raw referrer is never grouped or filtered on. */
	referrerHost?: string | null
	country?: string | null
	region?: string | null
	city?: string | null
	language?: string | null
	utmSource?: string | null
	utmMedium?: string | null
	utmCampaign?: string | null
	utmContent?: string | null
	utmTerm?: string | null
	visitorHash: string
	sessionId: string
	durationMs?: number | null
	scrollDepth?: number | null
	/** Goal completions stamped at ingest; the source of conversions/revenue on this path. */
	goals?: Array<{ slug: string; value: number }>
}

const HOUR_MS = 3_600_000

type EventStringField =
	| 'path'
	| 'country'
	| 'region'
	| 'city'
	| 'device'
	| 'browser'
	| 'os'
	| 'language'
	| 'source'
	| 'channel'
	| 'referrerHost'
	| 'utmSource'
	| 'utmMedium'
	| 'utmCampaign'
	| 'utmContent'
	| 'utmTerm'
	| 'name'

/**
 * Dimensions native can filter/group on directly against the events collection. `referrer`
 * reads the host derived at ingest rather than the raw referrer, since a `where` cannot
 * reduce a URL to its host; it is the same field the rollup bucket is keyed by.
 */
const EVENT_FIELD: Partial<Record<DimensionKey, EventStringField>> = {
	page: 'path',
	country: 'country',
	region: 'region',
	city: 'city',
	device: 'device',
	browser: 'browser',
	os: 'os',
	language: 'language',
	source: 'source',
	channel: 'channel',
	referrer: 'referrerHost',
	utmSource: 'utmSource',
	utmMedium: 'utmMedium',
	utmCampaign: 'utmCampaign',
	utmContent: 'utmContent',
	utmTerm: 'utmTerm',
	event: 'name',
}

const FILTER_OPERATOR: Record<'eq' | 'contains', string> = { eq: 'equals', contains: 'contains' }

/**
 * Payload where fragment for supported filters; unsupported dimensions/operators are
 * dropped. Capability gating (`filters`/`filterOperators`) is the real contract upstream,
 * this is just the safety net so a stray unsupported filter never throws.
 * `contains` is case-insensitive on both DBs; on Postgres its value is a raw ILIKE
 * pattern (`%`/`_` act as wildcards), while Mongo regex-escapes the value first.
 * One fragment per filter under `and`, not merged by key: two filters on the same field
 * (e.g. two `eq` values) must both constrain the query rather than the later one silently
 * overwriting the earlier one.
 */
export const filtersToWhere = (filters: AnalyticsFilter[]): Record<string, unknown> => {
	const fragments: Record<string, unknown>[] = []
	for (const filter of filters) {
		const field = EVENT_FIELD[filter.dimension]
		if (!field || filter.operator === 'matches') {
			continue
		}
		const op = FILTER_OPERATOR[filter.operator]
		if (!op) {
			continue
		}
		fragments.push({ [field]: { [op]: filter.value } })
	}
	return fragments.length > 0 ? { and: fragments } : {}
}

interface Bucket {
	pageviews: number
	events: number
	durationMs: number
	visitors: Set<string>
	sessions: Set<string>
	conversions: number
	revenue: number
	scrollDepthSum: number
	scrollSamples: number
}

const emptyBucket = (): Bucket => ({
	pageviews: 0,
	events: 0,
	durationMs: 0,
	visitors: new Set(),
	sessions: new Set(),
	conversions: 0,
	revenue: 0,
	scrollDepthSum: 0,
	scrollSamples: 0,
})

/**
 * `completions` narrows what the event contributes to conversions/revenue: a goal breakdown
 * row counts only its own goal, every other bucket counts all of them. Mirrors how
 * computeRollupDeltas fills a `goal` bucket versus a site or page bucket.
 */
const addEvent = (bucket: Bucket, event: EventLike, completions = event.goals ?? []): void => {
	if (event.type === 'pageview') {
		bucket.pageviews++
		bucket.durationMs += event.durationMs ?? 0
	} else {
		bucket.events++
	}
	// A reported 0 is a sample; a missing depth is not, however the driver spells "missing".
	if (typeof event.scrollDepth === 'number') {
		bucket.scrollDepthSum += event.scrollDepth
		bucket.scrollSamples++
	}
	bucket.conversions += completions.length
	for (const completion of completions) {
		bucket.revenue += completion.value
	}
	bucket.visitors.add(event.visitorHash)
	bucket.sessions.add(event.sessionId)
}

const selectMetrics = (bucket: Bucket, wanted: MetricKey[]): Partial<Record<MetricKey, number>> => {
	const out: Partial<Record<MetricKey, number>> = {}
	if (wanted.includes('pageviews')) out.pageviews = bucket.pageviews
	if (wanted.includes('events')) out.events = bucket.events
	if (wanted.includes('visitors')) out.visitors = bucket.visitors.size
	if (wanted.includes('sessions')) out.sessions = bucket.sessions.size
	if (wanted.includes('conversions')) out.conversions = bucket.conversions
	if (wanted.includes('revenue')) out.revenue = bucket.revenue
	if (wanted.includes('avgDuration')) {
		out.avgDuration = bucket.pageviews > 0 ? Math.round(bucket.durationMs / bucket.pageviews) : 0
	}
	if (wanted.includes('scrollDepth')) {
		out.scrollDepth =
			bucket.scrollSamples > 0 ? Math.round(bucket.scrollDepthSum / bucket.scrollSamples) : 0
	}
	return out
}

export interface AggregateEventsArgs {
	metrics: MetricKey[]
	dimension?: DimensionKey
	granularity?: 'hour' | 'day'
	timezone?: string
	/** Sort for dimension breakdown rows; defaults to pageviews desc, same as the rollup path. */
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
	/** Row cap for dimension breakdown rows, applied after sorting. */
	limit?: number
}

export interface AggregateEventsResult {
	rows: AnalyticsRow[]
	totals: Partial<Record<MetricKey, number>>
}

/**
 * Hour buckets are UTC-hour floors regardless of `timezone`; sub-day bucketing ignoring
 * the reporting timezone is a documented v1 limitation. Day buckets floor in `timezone`
 * to stay aligned with native rollup day boundaries.
 */
const bucketKeyFor = (event: EventLike, granularity: 'hour' | 'day', timezone: string): string => {
	const ts = new Date(event.timestamp)
	if (granularity === 'hour') {
		return new Date(Math.floor(ts.getTime() / HOUR_MS) * HOUR_MS).toISOString()
	}
	return startOfDayInTz(ts, timezone).toISOString()
}

/**
 * Aggregate raw events into totals, plus one of: dimension breakdown rows or hour/day
 * series rows (dimension wins if both are requested). Totals always cover every event
 * passed in, independent of which rows a breakdown or series produces.
 */
export const aggregateEvents = (
	events: EventLike[],
	{
		metrics,
		dimension,
		granularity,
		timezone = DEFAULT_TIMEZONE,
		order,
		limit,
	}: AggregateEventsArgs
): AggregateEventsResult => {
	const totalsBucket = emptyBucket()
	for (const event of events) {
		addEvent(totalsBucket, event)
	}
	const totals = selectMetrics(totalsBucket, metrics)

	const field = dimension ? EVENT_FIELD[dimension] : undefined
	if (dimension && (field || dimension === 'goal')) {
		const groups = new Map<string, Bucket>()
		const bucketFor = (value: string): Bucket => {
			let bucket = groups.get(value)
			if (!bucket) {
				bucket = emptyBucket()
				groups.set(value, bucket)
			}
			return bucket
		}
		for (const event of events) {
			if (dimension === 'goal') {
				for (const completion of event.goals ?? []) {
					addEvent(bucketFor(completion.slug), event, [completion])
				}
				continue
			}
			// The event dimension reports named custom events only: a goal event's name is a
			// goal slug and belongs to the goal dimension instead.
			if (!field || (field === 'name' && event.type !== 'event')) {
				continue
			}
			const value = event[field]
			if (!value) {
				continue
			}
			addEvent(bucketFor(value), event)
		}
		let rows: AnalyticsRow[] = [...groups].map(([value, bucket]) => ({
			dimensions: { [dimension]: value } as Partial<Record<DimensionKey, string>>,
			metrics: selectMetrics(bucket, metrics),
		}))
		const sortMetric = order?.metric ?? 'pageviews'
		const direction = (order?.direction ?? 'desc') === 'asc' ? 1 : -1
		rows.sort((a, b) => ((a.metrics[sortMetric] ?? 0) - (b.metrics[sortMetric] ?? 0)) * direction)
		if (limit) {
			rows = rows.slice(0, limit)
		}
		return { rows, totals }
	}

	if (granularity) {
		const buckets = new Map<string, Bucket>()
		for (const event of events) {
			const key = bucketKeyFor(event, granularity, timezone)
			let bucket = buckets.get(key)
			if (!bucket) {
				bucket = emptyBucket()
				buckets.set(key, bucket)
			}
			addEvent(bucket, event)
		}
		const rows: AnalyticsRow[] = [...buckets.entries()]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([timestamp, bucket]) => ({ timestamp, metrics: selectMetrics(bucket, metrics) }))
		return { rows, totals }
	}

	return { rows: [{ metrics: totals }], totals }
}
