import type { SerializedCapabilities } from '../core/capabilities'
import {
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type Granularity,
	type MetricKey,
} from '../core/contract'
import { GRANULARITY_ORDER } from '../core/granularity'
import type { SourcesResponse, WireSource } from '../fields/config/fetchSources'
import { parseDayOrInstant } from '../query/dates'
import { previousWindow, withinLookback } from '../widgets/comparison'
import { dayRangeDays } from './dayRange'

/** Every metric the view can show, in the order the overview cards read. */
export const VIEW_METRIC_ORDER: MetricKey[] = [
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'avgDuration',
	'bounceRate',
	'scrollDepth',
	'events',
	'conversions',
	'revenue',
]

export type BreakdownTab = 'pages' | 'sources' | 'technology' | 'geography' | 'events' | 'goals'

export const BREAKDOWN_TABS: BreakdownTab[] = [
	'pages',
	'sources',
	'technology',
	'geography',
	'events',
	'goals',
]

/**
 * The dimensions each breakdown tab offers, most useful first. Every contract dimension
 * belongs to exactly one tab, so a source that serves a new dimension gains a column
 * rather than an unreachable capability. The first one a source serves is the tab's default,
 * which the reader changes through the breakdown's group-by picker, so the order decides what
 * a link carrying no `dim` opens on and is not free to change.
 *
 * `sources` leads with `channel` rather than `referrer`: a channel mix is the acquisition
 * question a reader opens this tab to ask, and it answers in a dozen buckets where the origins
 * below it run to hundreds of rows. `source` and `referrer` are each one pick away.
 */
export const TAB_DIMENSIONS: Record<BreakdownTab, DimensionKey[]> = {
	pages: ['page'],
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
	goals: ['goal'],
}

/** An inclusive window of reporting-timezone calendar days, as the endpoint takes them. */
export interface DayRange {
	from: string
	to: string
}

/**
 * What one source lets the view offer. Every control reads this instead of the raw
 * capabilities, so a provider that serves less gets a smaller but coherent view rather
 * than controls that fail at the endpoint.
 */
export interface ViewGate {
	metrics: MetricKey[]
	tabs: BreakdownTab[]
	/** What the tab can group by, in declared order. The first is the tab's default. */
	dimensionsFor: (tab: BreakdownTab) => DimensionKey[]
	canFilter: (dimension: DimensionKey) => boolean
	operators: FilterOperator[]
	/** Buckets the view offers, coarsest-inclusive, in contract order. Never finer than an hour. */
	granularities: Granularity[]
	/**
	 * Days the source can look back, or null for no limit. The engine clamps a longer read
	 * and marks it `meta.clamped`, so this lets the toolbar hide a range that would silently
	 * answer for a shorter window than its label promises, and {@link canCompareRange} drop
	 * a previous period that reaches past it.
	 */
	maxRangeDays: number | null
	canCompare: boolean
	canHour: boolean
	realtime: boolean
	goals: boolean
}

const HOUR_INDEX = GRANULARITY_ORDER.indexOf('hour')

export const gate = (caps: SerializedCapabilities): ViewGate => {
	const metricSet = new Set<string>(caps.metrics)
	const dimensionSet = new Set<string>(caps.dimensions)
	const filterSet = new Set<string>(caps.filters)
	const operatorSet = new Set<string>(caps.filterOperators)
	const served = Object.fromEntries(
		BREAKDOWN_TABS.map((tab) => [tab, TAB_DIMENSIONS[tab].filter((d) => dimensionSet.has(d))])
	) as Record<BreakdownTab, DimensionKey[]>
	// Floored at the hour: a minute-granular source over a year is hundreds of thousands of
	// buckets, and the endpoint only checks that a granularity is no finer than the source's.
	const finest = Math.max(GRANULARITY_ORDER.indexOf(caps.minGranularity), HOUR_INDEX)
	const granularities = GRANULARITY_ORDER.slice(finest)
	return {
		metrics: VIEW_METRIC_ORDER.filter((metric) => metricSet.has(metric)),
		tabs: BREAKDOWN_TABS.filter((tab) => served[tab].length > 0),
		dimensionsFor: (tab) => served[tab],
		canFilter: (dimension) => filterSet.has(dimension),
		operators: FILTER_OPERATORS.filter((operator) => operatorSet.has(operator)),
		granularities,
		maxRangeDays: caps.maxLookbackDays,
		canCompare: caps.comparison,
		canHour: granularities.includes('hour'),
		realtime: caps.realtime,
		goals: metricSet.has('conversions') && dimensionSet.has('goal'),
	}
}

/**
 * Whether the view may compare this window. `ViewGate.canCompare` answers for the source
 * alone; the previous period must also still be inside the source's lookback, or the
 * endpoint drops the comparison from its answer. The gate sees only capabilities, so every
 * surface that knows the selected window (the toolbar's toggle, the request builder) asks
 * here instead.
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
 * The bucket a range reads best at: hours for a window of a day or two, weeks past four
 * months, days between. Never finer than the source serves, so the endpoint's granularity
 * check cannot reject what the view picked for itself.
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
