import type { AnalyticsFilter, AnalyticsRow, DimensionKey, MetricKey } from '../../core/contract'
import { DEFAULT_TIMEZONE, startOfDayInTz } from '../../timeframe/tz'

/** Raw event shape aggregateEvents/filtersToWhere operate on; matches StoredEvent as read back from the events collection (timestamp comes back as an ISO string). */
export interface EventLike {
	timestamp: string | Date
	type: 'pageview' | 'event'
	name?: string
	path: string
	device?: string
	source?: string
	country?: string
	region?: string
	city?: string
	visitorHash: string
	sessionId: string
	durationMs?: number
}

const HOUR_MS = 3_600_000

type EventStringField = 'path' | 'country' | 'region' | 'city' | 'device' | 'source' | 'name'

/** Dimensions native can filter/group on directly against the events collection. */
const EVENT_FIELD: Partial<Record<DimensionKey, EventStringField>> = {
	page: 'path',
	country: 'country',
	region: 'region',
	city: 'city',
	device: 'device',
	source: 'source',
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
}

const emptyBucket = (): Bucket => ({
	pageviews: 0,
	events: 0,
	durationMs: 0,
	visitors: new Set(),
	sessions: new Set(),
})

const addEvent = (bucket: Bucket, event: EventLike): void => {
	if (event.type === 'pageview') {
		bucket.pageviews++
		bucket.durationMs += event.durationMs ?? 0
	} else {
		bucket.events++
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
	if (wanted.includes('avgDuration')) {
		out.avgDuration = bucket.pageviews > 0 ? Math.round(bucket.durationMs / bucket.pageviews) : 0
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
	if (dimension && field) {
		const groups = new Map<string, Bucket>()
		for (const event of events) {
			const value = event[field]
			if (!value) {
				continue
			}
			let bucket = groups.get(value)
			if (!bucket) {
				bucket = emptyBucket()
				groups.set(value, bucket)
			}
			addEvent(bucket, event)
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
