import {
	type AnalyticsFilter,
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type Granularity,
	type MetricKey,
	PLATFORM_SCOPE,
} from '../core/contract'
import { GRANULARITY_ORDER } from '../core/granularity'
import { servedName } from '../core/metricAliases'
import { isRecord, wholeNumberParam } from '../core/values'
import {
	MAX_QUERY_FILTER_VALUE_LENGTH,
	MAX_QUERY_FILTERS,
	MAX_QUERY_RANGE_DAYS,
} from '../query/limits'
import { resolveTimeframe, TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { zonedCalendarDay } from '../timeframe/tz'
import { dayRangeDays } from './dayRange'
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

/** @beta */
export const VIEW_LIMITS = [10, 25, 50, 100] as const

/** @beta */
export type ViewLimit = (typeof VIEW_LIMITS)[number]

export const DEFAULT_VIEW_LIMIT: ViewLimit = 10

export const DEFAULT_VIEW_TAB: BreakdownTab = 'pages'

/**
 * Everything the view reads from the URL. A view is its state, so a link is a view.
 *
 * @beta
 */
export interface ViewState {
	range: TimeframePreset | 'custom'
	/** Set only on a custom range: an inclusive `YYYY-MM-DD` day in the reporting timezone. */
	from?: string
	to?: string
	compare: boolean
	source?: string
	/**
	 * An {@link aggregateToken} when aggregating across every scope, absent for the request's own.
	 * No other value survives a render: the host owns which scope a request resolves to.
	 */
	scope?: string
	metric: MetricKey
	/** Absent means automatic; {@link autoGranularity} picks one from the range. */
	granularity?: Granularity
	tab: BreakdownTab
	/** The dimension the tab groups by. Absent means its default, the first one served. */
	dim?: DimensionKey
	filters: AnalyticsFilter[]
	limit: ViewLimit
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
}

/** The install's configured starting point, as `AnalyticsViewClientProps.defaults` carries it. */
export interface ViewDefaults {
	range: TimeframePreset
	metric: MetricKey
}

const AGGREGATE_TAG = `${PLATFORM_SCOPE}:`

/**
 * Aggregate marker tagged with the tenant it was chosen from: the host's selector can move while
 * the address stays open, and an untagged marker would aggregate under a tenant nobody asked for.
 */
export const aggregateToken = (from: string): string =>
	from === '' ? PLATFORM_SCOPE : `${AGGREGATE_TAG}${from}`

/** Whether `value` asks to aggregate: the bare wildcard or an {@link aggregateToken}. */
export const isAggregateToken = (value: string | null | undefined): boolean =>
	value === PLATFORM_SCOPE || (typeof value === 'string' && value.startsWith(AGGREGATE_TAG))

/** The tenant an aggregate token was chosen from; `''` when it names none. */
export const aggregateFrom = (token: string): string =>
	token.startsWith(AGGREGATE_TAG) ? token.slice(AGGREGATE_TAG.length) : ''

/** A filter's identity, which its chip keys on. */
export const filterKey = ({ dimension, operator, value }: AnalyticsFilter): string =>
	`${dimension}:${operator}:${value}`

/** `state` with its filter at `index` removed. */
export const withoutFilter = (state: ViewState, index: number): ViewState => ({
	...state,
	filters: state.filters.filter((_, at) => at !== index),
})

const known = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
	list.find((entry) => entry === value)

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const read = (search: URLSearchParams, name: string): string | null => {
	const raw = search.get(name)?.trim()
	return raw ? raw : null
}

/**
 * Whether `raw` is a `YYYY-MM-DD` day naming a real calendar day. The round trip is the
 * validation: `Date.parse` rolls February 30 forward instead of failing.
 */
const isCalendarDay = (raw: string | null): raw is string => {
	if (raw === null || !DAY_PATTERN.test(raw)) {
		return false
	}
	const ms = Date.parse(`${raw}T00:00:00.000Z`)
	return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === raw
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
		const from = read(search, 'from')
		const to = read(search, 'to')
		// Same-length ISO days order as strings do.
		if (!isCalendarDay(from) || !isCalendarDay(to) || to < from) {
			return fallback
		}
		// Beyond the endpoint's own cap the read would only ever answer `range_too_long`.
		if (dayRangeDays({ from, to }) > MAX_QUERY_RANGE_DAYS) {
			return fallback
		}
		return { range: 'custom', from, to }
	}
	const preset = known(TIMEFRAME_PRESETS, raw)
	if (preset === undefined || preset === 'allTime') {
		return fallback
	}
	return { range: preset }
}

/**
 * Filters as the endpoint parser accepts them; invalid entries drop so a hand-edited link still
 * opens. Repeats drop too: chips key on {@link filterKey}, so duplicates would collide in React.
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
	const seen = new Set<string>()
	for (const item of decoded) {
		if (filters.length === MAX_QUERY_FILTERS) {
			break
		}
		if (!isRecord(item) || Array.isArray(item)) {
			continue
		}
		const dimension = known(DIMENSION_KEYS, item.dimension)
		const operator = known(FILTER_OPERATORS, item.operator)
		const { value } = item
		if (dimension === undefined || operator === undefined) {
			continue
		}
		if (typeof value !== 'string') {
			continue
		}
		const trimmed = value.trim()
		if (trimmed.length < 1 || trimmed.length > MAX_QUERY_FILTER_VALUE_LENGTH) {
			continue
		}
		const filter = { dimension, operator, value: trimmed }
		const key = filterKey(filter)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		filters.push(filter)
	}
	return filters
}

const parseOrder = (search: URLSearchParams): ViewState['order'] => {
	const raw = read(search, 'order')
	if (raw === null) {
		return undefined
	}
	const parts = raw.split(':')
	const metric = known(VIEW_METRIC_ORDER, parts[0])
	const direction = parts[1] ?? ''
	if (parts.length !== 2 || metric === undefined) {
		return undefined
	}
	if (direction !== 'asc' && direction !== 'desc') {
		return undefined
	}
	return { metric, direction }
}

/**
 * Total by construction: every value the URL cannot justify falls back to the install
 * default, so a truncated, stale or hand-edited link always opens a working view.
 */
export const parseViewState = (search: URLSearchParams, defaults: ViewDefaults): ViewState => {
	const metric = known(VIEW_METRIC_ORDER, read(search, 'metric'))
	const granularity = known(GRANULARITY_ORDER, read(search, 'granularity'))
	const tab = known(BREAKDOWN_TABS, read(search, 'tab'))
	const dim = known(DIMENSION_KEYS, read(search, 'dim'))
	const source = read(search, 'source')
	const scope = read(search, 'scope')
	const limit = wholeNumberParam(read(search, 'limit'))
	const compare = read(search, 'compare')
	const order = parseOrder(search)
	return {
		...parseRange(search, defaults),
		compare: compare === '1' || compare === 'true',
		...(source === null ? {} : { source }),
		// The aggregate marker is the only scope a URL may name: every other one is the host's
		// own answer for the request, which an address cannot override.
		...(scope !== null && isAggregateToken(scope) ? { scope } : {}),
		metric: metric ?? defaults.metric,
		...(granularity === undefined ? {} : { granularity }),
		tab: tab ?? DEFAULT_VIEW_TAB,
		...(dim === undefined ? {} : { dim }),
		filters: parseFilters(search),
		limit: VIEW_LIMITS.find((each) => each === limit) ?? DEFAULT_VIEW_LIMIT,
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
	if (state.scope !== undefined) {
		params.set('scope', state.scope)
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
	if (state.dim !== undefined) {
		params.set('dim', state.dim)
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
 * Nearest state the selected source serves: the URL outlives a source switch, so what it lacks is
 * replaced or dropped here. Same object when the gate forbids nothing, for identity checks.
 */
export const coerceState = (state: ViewState, gate: ViewGate): ViewState => {
	const named = servedName(state.metric, gate.metrics)
	const metric = gate.metrics.includes(named) ? named : (gate.metrics[0] ?? state.metric)
	const tab = gate.tabs.includes(state.tab) ? state.tab : (gate.tabs[0] ?? state.tab)
	const dim =
		state.dim !== undefined && gate.dimensionsFor(tab).includes(state.dim) ? state.dim : undefined
	const compare = state.compare && gate.canCompare
	const filters = state.filters.filter((filter) =>
		gate.operatorsFor(filter.dimension).includes(filter.operator)
	)
	const granularity =
		state.granularity !== undefined && gate.granularities.includes(state.granularity)
			? state.granularity
			: undefined
	const order =
		state.order !== undefined && gate.columns.includes(state.order.metric) ? state.order : undefined
	const unchanged =
		metric === state.metric &&
		tab === state.tab &&
		dim === state.dim &&
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
		...(state.scope === undefined ? {} : { scope: state.scope }),
		metric,
		...(granularity === undefined ? {} : { granularity }),
		tab,
		...(dim === undefined ? {} : { dim }),
		filters,
		limit: state.limit,
		...(order === undefined ? {} : { order }),
	}
}

/**
 * State as the server read it: an unserved `source` drops and `scope` becomes the resolved one.
 * Same object when nothing needed correcting, so the URL is rewritten only on a change.
 */
export const normalizeViewState = (
	state: ViewState,
	served: { sourceIds: string[]; scope?: string }
): ViewState => {
	const source =
		state.source !== undefined && !served.sourceIds.includes(state.source)
			? undefined
			: state.source
	if (source === state.source && served.scope === state.scope) {
		return state
	}
	const { source: _source, scope: _scope, ...rest } = state
	return {
		...rest,
		...(source === undefined ? {} : { source }),
		...(served.scope === undefined ? {} : { scope: served.scope }),
	}
}

/**
 * Inclusive day window a state reads, in the reporting timezone the endpoint reads `from`/`to`
 * in, so toolbar caption and every request agree.
 */
export const rangeFor = (state: ViewState, timezone: string, now: Date): DayRange => {
	if (state.range === 'custom' && state.from !== undefined && state.to !== undefined) {
		return { from: state.from, to: state.to }
	}
	const preset = state.range === 'custom' ? DEFAULT_VIEW_RANGE : state.range
	const { start, end } = resolveTimeframe(preset, now, timezone)
	return { from: zonedCalendarDay(start, timezone), to: zonedCalendarDay(end, timezone) }
}
