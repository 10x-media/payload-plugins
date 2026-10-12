import {
	filterOperatorsFor,
	metricReaches,
	type SerializedCapabilities,
} from '../core/capabilities'
import type { DimensionKey, FilterOperator, Granularity, MetricKey } from '../core/contract'
import { GRANULARITY_ORDER } from '../core/granularity'
import type { SourcesResponse, WireSource } from '../fields/config/fetchSources'
import { parseDayOrInstant } from '../query/dates'
import { previousWindow, withinLookback } from '../timeframe/comparison'
import { dayRangeDays } from './dayRange'
import { withoutVisitsAlias } from './metricAliases'

/** Every metric the view can show, in the order the overview cards read. */
export const VIEW_METRIC_ORDER: MetricKey[] = [
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'avgDuration',
	'visitDuration',
	'bounceRate',
	'scrollDepth',
	'events',
	'conversions',
	'revenue',
	'impressions',
	'interactions',
]

/**
 * Content item metrics, shown only as Content tab columns: views are counted per item only, and
 * clicks, though summable site-wide, say little apart from the item they landed on.
 */
export const ITEM_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>([
	'impressions',
	'interactions',
])

/** @beta */
export type BreakdownTab =
	| 'pages'
	| 'content'
	| 'sources'
	| 'technology'
	| 'geography'
	| 'events'
	| 'goals'

export const BREAKDOWN_TABS: BreakdownTab[] = [
	'pages',
	'content',
	'sources',
	'technology',
	'geography',
	'events',
	'goals',
]

/**
 * Dimensions per breakdown tab, most useful first; every contract dimension sits in exactly one.
 * The first one served is the tab's default (what a link without `dim` opens), so order matters.
 */
export const TAB_DIMENSIONS: Record<BreakdownTab, DimensionKey[]> = {
	pages: ['page'],
	// The things shown on the pages rather than the pages themselves: offers, banners, cards.
	content: ['item'],
	sources: [
		'channel',
		'source',
		'referrer',
		'medium',
		'campaign',
		'utmSource',
		'utmMedium',
		'utmCampaign',
		'utmContent',
		'utmTerm',
	],
	technology: ['device', 'browser', 'os'],
	geography: ['country', 'region', 'city', 'language'],
	events: ['event'],
	// `currency` belongs beside the goals: it is a cut of the same money, by the code the amount
	// arrived in, which is the one question a single revenue sum cannot answer.
	goals: ['goal', 'currency'],
}

/**
 * Metric columns, in display order, for dimensions where the generic answer (selected metric plus
 * visitors) is structurally zero. {@link RATE_DIMENSIONS} adds the derived rate beside these.
 */
export const DIMENSION_METRICS: Partial<Record<DimensionKey, MetricKey[]>> = {
	event: ['events', 'visitors'],
	goal: ['conversions', 'revenue'],
	currency: ['revenue', 'conversions'],
	// Views, then clicks; the click rate sits between clicks and conversions.
	item: ['impressions', 'interactions', 'conversions'],
}

/**
 * Dimensions with a conversion-rate column (row's visitors over the site's), derived from two
 * reads rather than served, so no source is asked for it and it is never a sort column.
 */
export const RATE_DIMENSIONS: DimensionKey[] = ['event', 'goal']

/**
 * Dimensions whose breakdown carries a click-rate column instead: each row's own clicks over
 * its own views, both read in the same request.
 */
export const CLICK_RATE_DIMENSIONS: DimensionKey[] = ['item']

/**
 * An inclusive window of reporting-timezone calendar days, as the endpoint takes them.
 *
 * @beta
 */
export interface DayRange {
	from: string
	to: string
}

/**
 * What one source lets the view offer. Every control reads this, not raw capabilities, so a
 * provider serving less gets a smaller coherent view rather than controls that fail.
 */
export interface ViewGate {
	/** The metrics of the cards and the trend, which read the whole site. */
	metrics: MetricKey[]
	/** Every metric a breakdown column may show and be sorted by, the item ones included. */
	columns: MetricKey[]
	tabs: BreakdownTab[]
	/** What the tab can group by, in declared order. The first is the tab's default. */
	dimensionsFor: (tab: BreakdownTab) => DimensionKey[]
	/**
	 * Columns a breakdown of this dimension shows, narrowed to what the source serves; `selected`
	 * leads unless {@link DIMENSION_METRICS} lists it. First column drives bars and default sort.
	 */
	metricsFor: (dimension: DimensionKey, selected: MetricKey) => MetricKey[]
	/** The operators the source filters this dimension with, in contract order; empty when none. */
	operatorsFor: (dimension: DimensionKey) => FilterOperator[]
	/** Buckets the view offers, coarsest-inclusive, in contract order. Never finer than an hour. */
	granularities: Granularity[]
	/**
	 * Days the source can look back, null for no limit. The engine clamps longer reads, so the
	 * toolbar hides such ranges and {@link canCompareRange} drops a previous period past it.
	 */
	maxRangeDays: number | null
	canCompare: boolean
	canHour: boolean
	realtime: boolean
	goals: boolean
}

const HOUR_INDEX = GRANULARITY_ORDER.indexOf('hour')

/** The {@link ViewGate} of one source, from the capabilities it declares. */
export const gate = (caps: SerializedCapabilities): ViewGate => {
	const metricSet = new Set<string>(caps.metrics)
	const dimensionSet = new Set<string>(caps.dimensions)
	const operatorsFor = (dimension: DimensionKey): FilterOperator[] =>
		filterOperatorsFor(caps, dimension)
	const servedIn = (tab: BreakdownTab): DimensionKey[] =>
		TAB_DIMENSIONS[tab].filter((d) => dimensionSet.has(d))
	// Floored at the hour: a minute-granular source over a year is hundreds of thousands of
	// buckets, and the endpoint only checks that a granularity is no finer than the source's.
	const finest = Math.max(GRANULARITY_ORDER.indexOf(caps.minGranularity), HOUR_INDEX)
	const granularities = GRANULARITY_ORDER.slice(finest)
	const columns = withoutVisitsAlias(VIEW_METRIC_ORDER.filter((metric) => metricSet.has(metric)))
	// The cards and the trend read the whole site, which a metric needing a page cannot answer.
	const metrics = columns.filter(
		(metric) => !ITEM_METRICS.has(metric) && metricReaches(caps, metric, {})
	)
	const metricsFor = (dimension: DimensionKey, selected: MetricKey): MetricKey[] => {
		const under = (metric: MetricKey): boolean =>
			metricSet.has(metric) && metricReaches(caps, metric, { dimensions: [dimension] })
		const preferred = DIMENSION_METRICS[dimension] ?? [selected, 'visitors']
		const columns = [...new Set(preferred)].filter(under)
		if (columns.length > 0) {
			return columns
		}
		// The source serves none of the dimension's own columns, so the breakdown falls back
		// to whatever it can answer rather than asking for a column of zeros.
		const fallback = [selected, ...metrics].find(under)
		return fallback === undefined ? [] : [fallback]
	}
	return {
		metrics,
		columns,
		tabs: BREAKDOWN_TABS.filter((tab) => servedIn(tab).length > 0),
		dimensionsFor: servedIn,
		metricsFor,
		operatorsFor,
		granularities,
		maxRangeDays: caps.maxLookbackDays,
		canCompare: caps.comparison,
		canHour: granularities.includes('hour'),
		realtime: caps.realtime,
		goals:
			metricSet.has('conversions') &&
			dimensionSet.has('goal') &&
			metricReaches(caps, 'conversions', { dimensions: ['goal'] }),
	}
}

/**
 * Whether the view may compare this window: beyond `ViewGate.canCompare`, the previous period must
 * sit inside the source's lookback or the endpoint drops the comparison.
 */
export const canCompareRange = (
	served: ViewGate,
	range: DayRange,
	args: { timezone: string; now: Date }
): boolean => {
	if (!served.canCompare) {
		return false
	}
	const { timezone, now } = args
	const start = parseDayOrInstant(range.from, { timezone, edge: 'start' })
	const end = parseDayOrInstant(range.to, { timezone, edge: 'end' })
	if (!start || !end) {
		return false
	}
	const previous = previousWindow({ start, end }, timezone)
	return previous !== null && withinLookback(previous, served.maxRangeDays, { tz: timezone, now })
}

/**
 * Bucket a range reads best at: hours up to two days, weeks past four months, days between. Never
 * finer than the source serves, so the endpoint's granularity check cannot reject it.
 */
export const autoGranularity = (range: DayRange, caps: SerializedCapabilities): Granularity => {
	const days = dayRangeDays(range)
	const finest = GRANULARITY_ORDER.indexOf(caps.minGranularity)
	const serves = (granularity: Granularity): boolean =>
		GRANULARITY_ORDER.indexOf(granularity) >= finest
	const candidate: Granularity =
		days <= 2 && serves('hour') ? 'hour' : days > 120 && serves('week') ? 'week' : 'day'
	return serves(candidate) ? candidate : caps.minGranularity
}

/**
 * The source a view state reads from: the selected one, else the scope's default, else
 * the first readable one. Null when the scope has no readable source at all.
 */
export const resolveSource = (sources: SourcesResponse, sourceId?: string): WireSource | null => {
	const selected = sourceId ? sources.sources.find((source) => source.id === sourceId) : undefined
	const fallback = sources.sources.find((source) => source.id === sources.defaultId)
	return selected ?? fallback ?? sources.sources[0] ?? null
}
