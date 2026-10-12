import type { AnalyticsFilter, AnalyticsQuery, DimensionKey, MetricKey } from '../../core/contract'
import { addCalendarDays, type CalendarDay } from '../../timeframe/calendar'
import { AGGREGATION_VERSION, kindOf } from '../store/aggregate'
import { isRawDimension, type RawAxis, type RawDimension } from '../store/rawRead'
import { SETTLE_MS } from '../store/state'
import type { AggDim, DayMarker, FoldRead, RawOrder } from '../store/types'
import { type LocalDay, markerStart } from './days'

/**
 * Whether a completed marker was counted the current way over the window its day is read in: the
 * current aggregation version, in `tz`, from where that window starts.
 */
export const countedOver = (marker: DayMarker, tz: string, window: LocalDay): boolean =>
	marker.version === AGGREGATION_VERSION &&
	marker.tz === tz &&
	markerStart(marker).getTime() === window.start.getTime()

/**
 * Whether a day's rows hold the whole day, counted the current way over its window: aggregated
 * after it closed (`provisional`, `final`), or a snapshot taken once it had settled.
 */
export const holdsWholeDay = (
	marker: DayMarker | undefined,
	tz: string,
	window: LocalDay
): boolean => {
	if (!marker || marker.gen === null || !countedOver(marker, tz, window)) {
		return false
	}
	if (marker.status === 'provisional' || marker.status === 'final') {
		return true
	}
	return (
		marker.status === 'partial' &&
		marker.aggregatedAt !== null &&
		marker.aggregatedAt.getTime() >= window.end.getTime() + SETTLE_MS
	)
}

/**
 * Where a closed day is read from: its rows, nowhere, a `probe` first, an `aggregate` first (rows
 * missing or counted another way), or `failed` (given up on: whatever an earlier count left).
 */
export type ClosedDaySource = 'aggregates' | 'empty' | 'probe' | 'aggregate' | 'failed'

export const closedDaySource = (args: {
	marker: DayMarker | undefined
	tz: string
	/** The window the day is read over in `tz` (see `windowOf`). */
	window: LocalDay
	/** Its count is fixed: part of what it counted is gone from the raw hits (see `isFixed`). */
	fixed: boolean
}): ClosedDaySource => {
	const { marker, tz, window, fixed } = args
	if (!marker) {
		return 'probe'
	}
	if (marker.status === 'failed') {
		return 'failed'
	}
	// The only numbers a fixed day has, whatever zone or version they were counted in.
	if (fixed) {
		return marker.gen === null ? 'empty' : 'aggregates'
	}
	if (marker.status === 'empty') {
		return countedOver(marker, tz, window) ? 'empty' : 'probe'
	}
	return holdsWholeDay(marker, tz, window) ? 'aggregates' : 'aggregate'
}

/** Consecutive dates as runs `[first, last]`, in the order given, which must ascend. */
export const runsOf = (days: readonly CalendarDay[]): Array<[CalendarDay, CalendarDay]> => {
	const runs: Array<[CalendarDay, CalendarDay]> = []
	for (const day of days) {
		const run = runs.at(-1)
		if (run && addCalendarDays(run[1], 1) === day) {
			run[1] = day
		} else {
			runs.push([day, day])
		}
	}
	return runs
}

/**
 * How many hits a closed day's marker says it holds, when its count is of the whole day: taken
 * once the day had ended. Null for a day never counted, or counted only while it ran.
 */
export const wholeDayHits = (marker: DayMarker | undefined, window: LocalDay): number | null =>
	marker?.hits !== undefined &&
	marker.hits !== null &&
	marker.aggregatedAt !== null &&
	marker.aggregatedAt >= window.end
		? marker.hits
		: null

/**
 * A running day's snapshot: `fresh` within `maxAgeMs` of its count, `stale` past it (served while a
 * new one is taken), `none` without one counted the current way over its window.
 */
export const snapshotState = (
	marker: DayMarker | undefined,
	at: { tz: string; window: LocalDay; now: Date; maxAgeMs: (hits: number) => number }
): 'fresh' | 'stale' | 'none' => {
	const { tz, window, now, maxAgeMs } = at
	if (
		marker?.status !== 'partial' ||
		marker.gen === null ||
		marker.aggregatedAt === null ||
		!countedOver(marker, tz, window)
	) {
		return 'none'
	}
	return now.getTime() - marker.aggregatedAt.getTime() <= maxAgeMs(marker.hits ?? 0)
		? 'fresh'
		: 'stale'
}

/** The aggregate rows one part of a read sums: a dimension's, one value's, or a pair's. */
export interface AggregateTarget {
	dim: AggDim
	value?: string
	dim2?: AggDim
}

/**
 * The aggregate rows a read's totals, day series and breakdown use. `raw` when only raw hits can
 * answer its rows, with `total` still set when its filters alone have rows of their own.
 */
export type ReadShape =
	| {
			source: 'aggregates'
			total: AggregateTarget
			breakdown?: AggregateTarget & { groupBy: 'value' | 'value2' }
	  }
	| { source: 'raw'; total?: AggregateTarget }

/** The breakdowns a goal's pair rows are kept by. */
const GOAL_PAIRS: readonly RawDimension[] = ['channel', 'source', 'utmCampaign']

const RAW: ReadShape = { source: 'raw' }

/**
 * Aggregates answer unfiltered reads, one `eq` filter, a goal by channel, source or campaign and an
 * item by page; the rest and hours read raw, a lone `eq` filter's totals still from its own rows.
 */
export const readShape = (args: {
	filters: readonly AnalyticsFilter[]
	breakdown?: RawDimension
	hours: boolean
}): ReadShape => {
	const { filters, breakdown, hours } = args
	if (hours) {
		return RAW
	}
	if (filters.length === 0) {
		if (breakdown === undefined) {
			return { source: 'aggregates', total: { dim: '' } }
		}
		return kindOf(breakdown, '')
			? {
					source: 'aggregates',
					total: { dim: '' },
					breakdown: { dim: breakdown, groupBy: 'value' },
				}
			: RAW
	}
	const [only] = filters
	if (
		filters.length !== 1 ||
		!only ||
		only.operator !== 'eq' ||
		only.value === '' ||
		!isRawDimension(only.dimension) ||
		!kindOf(only.dimension, '')
	) {
		return RAW
	}
	const total = { dim: only.dimension, value: only.value }
	if (breakdown === undefined) {
		return { source: 'aggregates', total }
	}
	const pair =
		(only.dimension === 'goal' && GOAL_PAIRS.includes(breakdown)) ||
		(only.dimension === 'item' && breakdown === 'page')
	return pair && kindOf(only.dimension, breakdown)
		? { source: 'aggregates', total, breakdown: { ...total, dim2: breakdown, groupBy: 'value2' } }
		: { source: 'raw', total }
}

/** A value a read of daily totals asks about: one dimension's value, or a pair's first value. */
type FoldTarget = Pick<FoldRead, 'dim' | 'dim2' | 'value'>

/**
 * The values a read of daily totals asks about where a cap can fold them: its one `eq` filter's
 * value, and a pair breakdown's first value. A day that folded one is read from its raw hits.
 */
export const foldTargets = (shape: ReadShape): FoldTarget[] => {
	if (shape.source !== 'aggregates') {
		return []
	}
	const targets: FoldTarget[] = []
	const { total, breakdown } = shape
	if (total.value !== undefined && (kindOf(total.dim, '')?.cap ?? null) !== null) {
		targets.push({ dim: total.dim, value: total.value })
	}
	if (
		breakdown?.dim2 !== undefined &&
		breakdown.value !== undefined &&
		(kindOf(breakdown.dim, breakdown.dim2)?.cap ?? null) !== null
	) {
		targets.push({ dim: breakdown.dim, dim2: breakdown.dim2, value: breakdown.value })
	}
	return targets
}

const sameFilter = (a: AnalyticsFilter, b: AnalyticsFilter): boolean =>
	a.dimension === b.dimension && a.operator === b.operator && a.value === b.value

const equals = (dimension: DimensionKey, value: string | undefined): AnalyticsFilter[] =>
	value === undefined ? [] : [{ dimension, operator: 'eq', value }]

/**
 * A read's filters with its page and its item folded in as `eq` filters, each filter once: a
 * read of one page or one item is a read filtered to it.
 */
export const readFilters = (
	query: Pick<AnalyticsQuery, 'filters' | 'path' | 'item'>
): AnalyticsFilter[] => {
	const all = [
		...(query.filters ?? []),
		...equals('page', query.path),
		...equals('item', query.item),
	]
	return all.filter(
		(filter, index) => all.findIndex((other) => sameFilter(filter, other)) === index
	)
}

/** What a read counts: goal completions, items seen and clicked, or hits. */
export const axisOf = (
	filters: readonly AnalyticsFilter[],
	breakdown: DimensionKey | undefined
): RawAxis => {
	const dimensions = [...filters.map((filter) => filter.dimension), breakdown]
	return dimensions.includes('goal') ? 'goal' : dimensions.includes('item') ? 'item' : 'hit'
}

const ORDER_PARTS: Record<MetricKey, Pick<RawOrder, 'part' | 'per'>> = {
	pageviews: { part: 'pageviews' },
	visitors: { part: 'visitors' },
	visits: { part: 'sessions' },
	sessions: { part: 'sessions' },
	bounceRate: { part: 'bounces', per: 'entries' },
	avgDuration: { part: 'durationMs', per: 'pageviews' },
	visitDuration: { part: 'sessionMs', per: 'sessions' },
	scrollDepth: { part: 'scrollSum', per: 'scrollSamples' },
	events: { part: 'events' },
	conversions: { part: 'conversions' },
	revenue: { part: 'revenue' },
	impressions: { part: 'impressions' },
	interactions: { part: 'interactions' },
}

/**
 * How a breakdown ranks, as parts: an average by its own numerator over its own denominator. By
 * default items rank by how often they were seen, goals by completions, the rest by pageviews.
 */
export const orderOf = (query: Pick<AnalyticsQuery, 'order'>, axis: RawAxis): RawOrder => {
	const metric =
		query.order?.metric ??
		(axis === 'item' ? 'impressions' : axis === 'goal' ? 'conversions' : 'pageviews')
	return { ...ORDER_PARTS[metric], dir: query.order?.direction ?? 'desc' }
}

const VISIT_METRICS: ReadonlySet<MetricKey> = new Set([
	'visits',
	'sessions',
	'bounceRate',
	'visitDuration',
])

/** Whether a read counts visits, which a raw read only does when it cuts them. */
export const countsVisits = (query: Pick<AnalyticsQuery, 'metrics' | 'order'>): boolean =>
	query.metrics.some((metric) => VISIT_METRICS.has(metric)) ||
	(query.order !== undefined && VISIT_METRICS.has(query.order.metric))

/** The series a read asks for; a breakdown wins over a series. */
export type SeriesUnit = 'hour' | 'day' | 'week' | 'month'

export const seriesOf = (
	query: Pick<AnalyticsQuery, 'granularity'>,
	breakdown: DimensionKey | undefined
): SeriesUnit | undefined => {
	const unit = query.granularity
	return breakdown === undefined &&
		(unit === 'hour' || unit === 'day' || unit === 'week' || unit === 'month')
		? unit
		: undefined
}
