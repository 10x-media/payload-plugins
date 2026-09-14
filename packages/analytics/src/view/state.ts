import {
	type AnalyticsFilter,
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type Granularity,
	type MetricKey,
} from '../core/contract'
import { GRANULARITY_ORDER } from '../core/granularity'
import {
	MAX_QUERY_FILTER_VALUE_LENGTH,
	MAX_QUERY_FILTERS,
	MAX_QUERY_RANGE_DAYS,
} from '../query/parse'
import { resolveTimeframe, TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { zonedCalendarDay } from '../timeframe/tz'
import {
	BREAKDOWN_TABS,
	type BreakdownTab,
	type DayRange,
	VIEW_METRIC_ORDER,
	type ViewGate,
} from './gating'

/**
 * The presets the toolbar offers. `allTime` is deliberately absent: it is unbounded, and
 * the query endpoint refuses any window longer than a year.
 */
export const VIEW_RANGE_PRESETS: TimeframePreset[] = [
	'today',
	'last7days',
	'last30days',
	'last90days',
	'lastYear',
]

export const DEFAULT_VIEW_RANGE: TimeframePreset = 'last30days'

export const VIEW_LIMITS = [10, 25, 50, 100] as const

export type ViewLimit = (typeof VIEW_LIMITS)[number]

export const DEFAULT_VIEW_LIMIT: ViewLimit = 10

export const DEFAULT_VIEW_TAB: BreakdownTab = 'pages'

/** Everything the view reads from the URL. A view is its state, so a link is a view. */
export interface ViewState {
	range: TimeframePreset | 'custom'
	/** Set only on a custom range: an inclusive `YYYY-MM-DD` day in the reporting timezone. */
	from?: string
	to?: string
	compare: boolean
	source?: string
	metric: MetricKey
	/** Absent means automatic; {@link autoGranularity} picks one from the range. */
	granularity?: Granularity
	tab: BreakdownTab
	filters: AnalyticsFilter[]
	limit: ViewLimit
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
}

/** The install's configured starting point, as `AnalyticsViewClientProps.defaults` carries it. */
export interface ViewDefaults {
	range: TimeframePreset
	metric: MetricKey
}

const KNOWN_METRICS = new Set<string>(VIEW_METRIC_ORDER)
const KNOWN_DIMENSIONS = new Set<string>(DIMENSION_KEYS)
const KNOWN_OPERATORS = new Set<string>(FILTER_OPERATORS)
const KNOWN_GRANULARITIES = new Set<string>(GRANULARITY_ORDER)
const KNOWN_PRESETS = new Set<string>(TIMEFRAME_PRESETS)
const DAY_MS = 86_400_000
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const read = (search: URLSearchParams, name: string): string | null => {
	const raw = search.get(name)?.trim()
	return raw ? raw : null
}

/**
 * Epoch ms of a `YYYY-MM-DD` day, or null when it names no real calendar day. The
 * round trip is the validation: `Date.parse` rolls February 30 forward instead of failing.
 */
const dayValue = (raw: string | null): number | null => {
	if (raw === null || !DAY_PATTERN.test(raw)) {
		return null
	}
	const ms = Date.parse(`${raw}T00:00:00.000Z`)
	if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== raw) {
		return null
	}
	return ms
}

/** A configured default the view cannot serve falls back to the built-in range. */
const defaultRange = (defaults: ViewDefaults): TimeframePreset =>
	defaults.range === 'allTime' ? DEFAULT_VIEW_RANGE : defaults.range

const parseRange = (
	search: URLSearchParams,
	defaults: ViewDefaults
): Pick<ViewState, 'range' | 'from' | 'to'> => {
	const fallback = { range: defaultRange(defaults) }
	const raw = read(search, 'range')
	if (raw === null) {
		return fallback
	}
	if (raw === 'custom') {
		const from = dayValue(read(search, 'from'))
		const to = dayValue(read(search, 'to'))
		if (from === null || to === null || to < from) {
			return fallback
		}
		// Beyond the endpoint's own cap the read would only ever answer `range_too_long`.
		if (Math.round((to - from) / DAY_MS) + 1 > MAX_QUERY_RANGE_DAYS) {
			return fallback
		}
		return {
			range: 'custom',
			from: new Date(from).toISOString().slice(0, 10),
			to: new Date(to).toISOString().slice(0, 10),
		}
	}
	if (!KNOWN_PRESETS.has(raw) || raw === 'allTime') {
		return fallback
	}
	return { range: raw as TimeframePreset }
}

/**
 * Filters as the endpoint's own parser would accept them, minus its errors: an entry
 * naming a dimension, operator or value outside the contract is dropped rather than
 * failing the whole URL, since a hand-edited link should still open a working view.
 */
const parseFilters = (search: URLSearchParams): AnalyticsFilter[] => {
	const raw = read(search, 'filters')
	if (raw === null) {
		return []
	}
	let decoded: unknown
	try {
		decoded = JSON.parse(raw)
	} catch {
		return []
	}
	if (!Array.isArray(decoded)) {
		return []
	}
	const filters: AnalyticsFilter[] = []
	for (const item of decoded) {
		if (filters.length === MAX_QUERY_FILTERS) {
			break
		}
		if (!isRecord(item)) {
			continue
		}
		const { dimension, operator, value } = item
		if (typeof dimension !== 'string' || !KNOWN_DIMENSIONS.has(dimension)) {
			continue
		}
		if (typeof operator !== 'string' || !KNOWN_OPERATORS.has(operator)) {
			continue
		}
		if (typeof value !== 'string') {
			continue
		}
		const trimmed = value.trim()
		if (trimmed.length < 1 || trimmed.length > MAX_QUERY_FILTER_VALUE_LENGTH) {
			continue
		}
		filters.push({
			dimension: dimension as DimensionKey,
			operator: operator as FilterOperator,
			value: trimmed,
		})
	}
	return filters
}

const parseOrder = (search: URLSearchParams): ViewState['order'] => {
	const raw = read(search, 'order')
	if (raw === null) {
		return undefined
	}
	const parts = raw.split(':')
	const metric = parts[0] ?? ''
	const direction = parts[1] ?? ''
	if (parts.length !== 2 || !KNOWN_METRICS.has(metric)) {
		return undefined
	}
	if (direction !== 'asc' && direction !== 'desc') {
		return undefined
	}
	return { metric: metric as MetricKey, direction }
}

/**
 * Total by construction: every value the URL cannot justify falls back to the install
 * default, so a truncated, stale or hand-edited link always opens a working view.
 */
export const parseViewState = (search: URLSearchParams, defaults: ViewDefaults): ViewState => {
	const metric = read(search, 'metric')
	const granularity = read(search, 'granularity')
	const tab = read(search, 'tab')
	const source = read(search, 'source')
	const limit = Number(read(search, 'limit'))
	const compare = read(search, 'compare')
	const order = parseOrder(search)
	return {
		...parseRange(search, defaults),
		compare: compare === '1' || compare === 'true',
		...(source === null ? {} : { source }),
		metric: metric !== null && KNOWN_METRICS.has(metric) ? (metric as MetricKey) : defaults.metric,
		...(granularity !== null && KNOWN_GRANULARITIES.has(granularity)
			? { granularity: granularity as Granularity }
			: {}),
		tab:
			tab !== null && BREAKDOWN_TABS.includes(tab as BreakdownTab)
				? (tab as BreakdownTab)
				: DEFAULT_VIEW_TAB,
		filters: parseFilters(search),
		limit: VIEW_LIMITS.includes(limit as ViewLimit) ? (limit as ViewLimit) : DEFAULT_VIEW_LIMIT,
		...(order === undefined ? {} : { order }),
	}
}

/**
 * The shortest URL that parses back to `state`: anything equal to a default is left out,
 * and the keys are written in one fixed order so an unchanged view never rewrites history.
 */
export const serializeViewState = (state: ViewState, defaults: ViewDefaults): URLSearchParams => {
	const params = new URLSearchParams()
	if (state.range !== defaultRange(defaults)) {
		params.set('range', state.range)
	}
	if (state.range === 'custom' && state.from !== undefined && state.to !== undefined) {
		params.set('from', state.from)
		params.set('to', state.to)
	}
	if (state.compare) {
		params.set('compare', '1')
	}
	if (state.source !== undefined) {
		params.set('source', state.source)
	}
	if (state.metric !== defaults.metric) {
		params.set('metric', state.metric)
	}
	if (state.granularity !== undefined) {
		params.set('granularity', state.granularity)
	}
	if (state.tab !== DEFAULT_VIEW_TAB) {
		params.set('tab', state.tab)
	}
	if (state.filters.length > 0) {
		params.set('filters', JSON.stringify(state.filters))
	}
	if (state.limit !== DEFAULT_VIEW_LIMIT) {
		params.set('limit', String(state.limit))
	}
	if (state.order !== undefined) {
		params.set('order', `${state.order.metric}:${state.order.direction}`)
	}
	return params
}

/**
 * The nearest state the selected source can actually serve. The URL outlives a source
 * switch, so a metric, tab, filter, comparison, bucket or sort the new source lacks is
 * replaced or dropped here rather than sent to the endpoint to be rejected. Returns the
 * same object when the gate forbids nothing, so a render can compare by identity.
 */
export const coerceState = (state: ViewState, gate: ViewGate): ViewState => {
	const metric = gate.metrics.includes(state.metric)
		? state.metric
		: (gate.metrics[0] ?? state.metric)
	const tab = gate.tabs.includes(state.tab) ? state.tab : (gate.tabs[0] ?? state.tab)
	const compare = state.compare && gate.canCompare
	const filters = state.filters.filter(
		(filter) => gate.canFilter(filter.dimension) && gate.operators.includes(filter.operator)
	)
	const granularity =
		state.granularity !== undefined && gate.granularities.includes(state.granularity)
			? state.granularity
			: undefined
	const order =
		state.order !== undefined && gate.metrics.includes(state.order.metric) ? state.order : undefined
	const unchanged =
		metric === state.metric &&
		tab === state.tab &&
		compare === state.compare &&
		filters.length === state.filters.length &&
		granularity === state.granularity &&
		order === state.order
	if (unchanged) {
		return state
	}
	return {
		range: state.range,
		...(state.from === undefined ? {} : { from: state.from }),
		...(state.to === undefined ? {} : { to: state.to }),
		compare,
		...(state.source === undefined ? {} : { source: state.source }),
		metric,
		...(granularity === undefined ? {} : { granularity }),
		tab,
		filters,
		limit: state.limit,
		...(order === undefined ? {} : { order }),
	}
}

/**
 * The inclusive day window a state reads, in the reporting timezone. The endpoint reads
 * `from`/`to` in that same timezone, so the toolbar caption and every request share one
 * answer. `now` is injected to keep callers deterministic.
 */
export const rangeFor = (state: ViewState, timezone: string, now: Date): DayRange => {
	if (state.range === 'custom' && state.from !== undefined && state.to !== undefined) {
		return { from: state.from, to: state.to }
	}
	const preset = state.range === 'custom' ? DEFAULT_VIEW_RANGE : state.range
	const { start, end } = resolveTimeframe(preset, now, timezone)
	return { from: zonedCalendarDay(start, timezone), to: zonedCalendarDay(end, timezone) }
}
