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
 * rather than an unreachable capability.
 */
export const TAB_DIMENSIONS: Record<BreakdownTab, DimensionKey[]> = {
	pages: ['page'],
	sources: [
		'referrer',
		'source',
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
	dimensionsFor: (tab: BreakdownTab) => DimensionKey[]
	canFilter: (dimension: DimensionKey) => boolean
	operators: FilterOperator[]
	/** Buckets the source serves, coarsest-inclusive, in contract order. */
	granularities: Granularity[]
	canCompare: boolean
	canHour: boolean
	realtime: boolean
	goals: boolean
}

export const gate = (caps: SerializedCapabilities): ViewGate => {
	const metricSet = new Set<string>(caps.metrics)
	const dimensionSet = new Set<string>(caps.dimensions)
	const filterSet = new Set<string>(caps.filters)
	const operatorSet = new Set<string>(caps.filterOperators)
	const served = Object.fromEntries(
		BREAKDOWN_TABS.map((tab) => [tab, TAB_DIMENSIONS[tab].filter((d) => dimensionSet.has(d))])
	) as Record<BreakdownTab, DimensionKey[]>
	const finest = GRANULARITY_ORDER.indexOf(caps.minGranularity)
	const granularities = GRANULARITY_ORDER.slice(finest === -1 ? 0 : finest)
	return {
		metrics: VIEW_METRIC_ORDER.filter((metric) => metricSet.has(metric)),
		tabs: BREAKDOWN_TABS.filter((tab) => served[tab].length > 0),
		dimensionsFor: (tab) => served[tab],
		canFilter: (dimension) => filterSet.has(dimension),
		operators: FILTER_OPERATORS.filter((operator) => operatorSet.has(operator)),
		granularities,
		canCompare: caps.comparison,
		canHour: granularities.includes('hour'),
		realtime: caps.realtime,
		goals: metricSet.has('conversions') && dimensionSet.has('goal'),
	}
}

const DAY_MS = 86_400_000

/** Calendar days a `YYYY-MM-DD` window covers, counting both ends; 1 for an unreadable one. */
const inclusiveDays = (range: DayRange): number => {
	const from = Date.parse(`${range.from}T00:00:00.000Z`)
	const to = Date.parse(`${range.to}T00:00:00.000Z`)
	if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
		return 1
	}
	return Math.round((to - from) / DAY_MS) + 1
}

/**
 * The bucket a range reads best at: hours for a window of a day or two, weeks past four
 * months, days between. Never finer than the source serves, so the endpoint's granularity
 * check cannot reject what the view picked for itself.
 */
export const autoGranularity = (range: DayRange, caps: SerializedCapabilities): Granularity => {
	const days = inclusiveDays(range)
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
