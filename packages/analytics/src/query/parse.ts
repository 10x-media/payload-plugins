import {
	filterOperatorsFor,
	metricOutOfReach,
	type SerializedCapabilities,
} from '../core/capabilities'
import type {
	AnalyticsFilter,
	AnalyticsQuery,
	DateRange,
	DimensionKey,
	Granularity,
	MetricKey,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { isDimensionKey, isFilterOperator, isGranularity, isMetricKey } from '../core/guards'
import { servedName } from '../core/metricAliases'
import { isOneOf, isRecord } from '../core/values'
import { parseItemRef } from '../items/ref'
import { type AnalyticsError, analyticsError } from '../plugin/errors'
import { isTimeframePreset, TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { isValidTimeZone } from '../timeframe/tz'
import { parseDayOrInstant } from './dates'
import {
	DEFAULT_QUERY_LIMIT,
	exceedsRangeCap,
	MAX_QUERY_DIMENSIONS,
	MAX_QUERY_FILTER_VALUE_LENGTH,
	MAX_QUERY_FILTERS,
	MAX_QUERY_HOSTNAME_LENGTH,
	MAX_QUERY_LIMIT,
	MAX_QUERY_METRICS,
	MAX_QUERY_PATH_LENGTH,
	MAX_QUERY_RANGE_DAYS,
	MIN_QUERY_LIMIT,
} from './limits'

/**
 * A validated read request. `source` and `scope` are absent by design: the handler must
 * resolve both before the parser can run, and reads them itself through {@link readParam}.
 */
export interface ParsedQuery {
	query: AnalyticsQuery
	compare: 'previous' | null
	/**
	 * The named timeframe the caller resolved `from` and `to` from, which lets the read be stored
	 * for the warm task to repeat; null when the caller named none.
	 */
	timeframe: TimeframePreset | null
}

export type ParseResult = { ok: true; value: ParsedQuery } | { ok: false; error: AnalyticsError }

interface ParseQueryArgs {
	capabilities: SerializedCapabilities
	/** Reporting timezone the plugin resolved for this request; the `timezone` param overrides it. */
	timezone: string
}

type Failure = Extract<ParseResult, { ok: false }>

/** One parameter's parsed value, or the failure that ends the parse. */
type Parsed<T> = { ok: true; value: T } | Failure

const parsed = <T>(value: T): Parsed<T> => ({ ok: true, value })

const fail = (code: AnalyticsError['code'], message: string, param: string): Failure => ({
	ok: false,
	error: analyticsError(code, message, param),
})

/** Echo a rejected value back in a message without letting a caller inflate the response. */
const echo = (value: string): string => (value.length > 40 ? `${value.slice(0, 40)}...` : value)

/**
 * A trimmed non-empty parameter, or null. Exported so the handler reads `source` and `scope`
 * exactly as the parser reads everything else.
 */
export const readParam = (params: URLSearchParams, name: string): string | null => {
	const raw = params.get(name)?.trim()
	return raw ? raw : null
}

const commaList = (raw: string): string[] =>
	raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)

const dedupe = <T extends string>(values: T[]): T[] => [...new Set(values)]

/**
 * Dimension list as the query parser reads it, for callers outside the query endpoint (document
 * panel). Unknown names are dropped, not refused: the caller wants blocks to draw, not an error.
 */
export const readDimensionList = (
	raw: string | null,
	max: number = MAX_QUERY_DIMENSIONS
): DimensionKey[] => dedupe(commaList(raw ?? '').filter(isDimensionKey)).slice(0, max)

const parseMetrics = (
	params: URLSearchParams,
	capabilities: SerializedCapabilities
): Parsed<MetricKey[]> => {
	const listed = commaList(readParam(params, 'metrics') ?? '')
	if (listed.length === 0) {
		return fail('invalid_param', 'metrics is required', 'metrics')
	}
	const unknown = listed.find((m) => !isMetricKey(m))
	if (unknown !== undefined) {
		return fail('invalid_param', `unknown metric: ${echo(unknown)}`, 'metrics')
	}
	const metrics = dedupe(listed.filter(isMetricKey))
	if (metrics.length > MAX_QUERY_METRICS) {
		return fail('invalid_param', `at most ${MAX_QUERY_METRICS} metrics are allowed`, 'metrics')
	}
	// A source serving one of `visits` and `sessions` answers the other under the name asked for.
	const unsupported = metrics.find(
		(m) => !capabilities.metrics.includes(servedName(m, capabilities.metrics))
	)
	if (unsupported !== undefined) {
		return fail('unsupported_metric', `source does not serve ${unsupported}`, 'metrics')
	}
	return parsed(metrics)
}

const parseDimensions = (
	params: URLSearchParams,
	capabilities: SerializedCapabilities
): Parsed<DimensionKey[]> => {
	const listed = commaList(readParam(params, 'dimensions') ?? '')
	const unknown = listed.find((d) => !isDimensionKey(d))
	if (unknown !== undefined) {
		return fail('invalid_param', `unknown dimension: ${echo(unknown)}`, 'dimensions')
	}
	const dimensions = dedupe(listed.filter(isDimensionKey))
	if (dimensions.length > MAX_QUERY_DIMENSIONS) {
		return fail(
			'invalid_param',
			`at most ${MAX_QUERY_DIMENSIONS} dimensions are allowed`,
			'dimensions'
		)
	}
	const unsupported = dimensions.find((d) => !capabilities.dimensions.includes(d))
	if (unsupported !== undefined) {
		return fail(
			'unsupported_dimension',
			`source does not break down by ${unsupported}`,
			'dimensions'
		)
	}
	return parsed(dimensions)
}

const parseRange = (params: URLSearchParams, timezone: string): Parsed<DateRange> => {
	const rawFrom = readParam(params, 'from')
	const rawTo = readParam(params, 'to')
	if (!rawFrom) {
		return fail('invalid_param', 'from is required', 'from')
	}
	const start = parseDayOrInstant(rawFrom, { timezone, edge: 'start' })
	if (!start) {
		return fail('invalid_param', `from is not a date: ${echo(rawFrom)}`, 'from')
	}
	if (!rawTo) {
		return fail('invalid_param', 'to is required', 'to')
	}
	const end = parseDayOrInstant(rawTo, { timezone, edge: 'end' })
	if (!end) {
		return fail('invalid_param', `to is not a date: ${echo(rawTo)}`, 'to')
	}
	if (end.getTime() < start.getTime()) {
		return fail('invalid_param', 'to must not be before from', 'to')
	}
	if (exceedsRangeCap({ start, end })) {
		return fail('range_too_long', `the range must not exceed ${MAX_QUERY_RANGE_DAYS} days`, 'to')
	}
	return parsed({ start, end })
}

const parseGranularity = (
	params: URLSearchParams,
	capabilities: SerializedCapabilities
): Parsed<Granularity | null> => {
	const raw = readParam(params, 'granularity')
	if (raw === null) {
		return parsed(null)
	}
	if (!isGranularity(raw)) {
		return fail('invalid_param', `unknown granularity: ${echo(raw)}`, 'granularity')
	}
	if (!supportsGranularity(capabilities, raw)) {
		return fail(
			'unsupported_granularity',
			`source buckets no finer than ${capabilities.minGranularity}`,
			'granularity'
		)
	}
	return parsed(raw)
}

const parseFilters = (
	params: URLSearchParams,
	capabilities: SerializedCapabilities
): Parsed<AnalyticsFilter[]> => {
	const raw = readParam(params, 'filters')
	if (raw === null) {
		return parsed([])
	}
	let decoded: unknown
	try {
		decoded = JSON.parse(raw)
	} catch {
		return fail('invalid_param', 'filters must be a JSON array', 'filters')
	}
	if (!Array.isArray(decoded)) {
		return fail('invalid_param', 'filters must be a JSON array', 'filters')
	}
	if (decoded.length > MAX_QUERY_FILTERS) {
		return fail('invalid_param', `at most ${MAX_QUERY_FILTERS} filters are allowed`, 'filters')
	}
	const filters: AnalyticsFilter[] = []
	for (const item of decoded) {
		if (!isRecord(item) || Array.isArray(item)) {
			return fail('invalid_param', 'each filter must be an object', 'filters')
		}
		const { dimension, operator, value } = item
		if (!isDimensionKey(dimension)) {
			return fail(
				'invalid_param',
				`unknown filter dimension: ${echo(String(dimension))}`,
				'filters'
			)
		}
		if (!isFilterOperator(operator)) {
			return fail('invalid_param', `unknown filter operator: ${echo(String(operator))}`, 'filters')
		}
		if (typeof value !== 'string') {
			return fail('invalid_param', 'each filter value must be a string', 'filters')
		}
		const trimmed = value.trim()
		if (trimmed.length < 1 || trimmed.length > MAX_QUERY_FILTER_VALUE_LENGTH) {
			return fail(
				'invalid_param',
				`each filter value must be 1 to ${MAX_QUERY_FILTER_VALUE_LENGTH} characters`,
				'filters'
			)
		}
		// Per pair, not per list: a source can take `contains` on one dimension and not another.
		const offered = filterOperatorsFor(capabilities, dimension)
		if (offered.length === 0) {
			return fail('unsupported_filter', `source cannot filter on ${dimension}`, 'filters')
		}
		if (!offered.includes(operator)) {
			return fail(
				'unsupported_operator',
				`source cannot filter ${dimension} with ${operator}`,
				'filters'
			)
		}
		filters.push({ dimension, operator, value: trimmed })
	}
	return parsed(filters)
}

const parseLimit = (params: URLSearchParams): Parsed<number> => {
	const raw = readParam(params, 'limit')
	if (raw === null) {
		return parsed(DEFAULT_QUERY_LIMIT)
	}
	if (!/^\d+$/.test(raw)) {
		return fail('invalid_param', `limit must be an integer: ${echo(raw)}`, 'limit')
	}
	const limit = Number(raw)
	if (limit < MIN_QUERY_LIMIT || limit > MAX_QUERY_LIMIT) {
		return fail(
			'invalid_param',
			`limit must be between ${MIN_QUERY_LIMIT} and ${MAX_QUERY_LIMIT}`,
			'limit'
		)
	}
	return parsed(limit)
}

const parseOrder = (
	params: URLSearchParams,
	metrics: readonly MetricKey[]
): Parsed<AnalyticsQuery['order']> => {
	const raw = readParam(params, 'order')
	if (raw === null) {
		return parsed(undefined)
	}
	const parts = raw.split(':')
	const metric = parts[0] ?? ''
	const direction = parts[1] ?? ''
	if (parts.length !== 2 || (direction !== 'asc' && direction !== 'desc')) {
		return fail('invalid_param', 'order must be <metric>:<asc|desc>', 'order')
	}
	if (!isOneOf(metrics, metric)) {
		return fail('invalid_param', `order metric is not in metrics: ${echo(metric)}`, 'order')
	}
	return parsed({ metric, direction })
}

/** The refusal of the first metric the source cannot read for a read of this shape. */
const outOfReach = (
	capabilities: SerializedCapabilities,
	metrics: readonly MetricKey[],
	shape: { dimensions: DimensionKey[]; filters: AnalyticsFilter[]; path: boolean }
): Failure | undefined => {
	for (const metric of metrics) {
		const out = metricOutOfReach(capabilities, servedName(metric, capabilities.metrics), shape)
		if (out !== null) {
			return fail(
				'unsupported_metric',
				'breakdown' in out
					? `source does not serve ${metric} by ${out.breakdown}`
					: `source serves ${metric} only by ${out.needs} or filtered by it`,
				'metrics'
			)
		}
	}
	return undefined
}

/**
 * First failing rule wins, in a fixed order: a value outside the contract is `invalid_param`, one
 * the source lacks its `unsupported_*` code; `source` and `scope` pass unvalidated.
 */
export const parseQueryParams = (params: URLSearchParams, args: ParseQueryArgs): ParseResult => {
	const { capabilities } = args
	const rawTimezone = readParam(params, 'timezone')
	if (rawTimezone !== null && !isValidTimeZone(rawTimezone)) {
		return fail('invalid_param', `unknown timezone: ${echo(rawTimezone)}`, 'timezone')
	}
	const timezone = rawTimezone ?? args.timezone
	const metrics = parseMetrics(params, capabilities)
	if (!metrics.ok) {
		return metrics
	}
	const dimensions = parseDimensions(params, capabilities)
	if (!dimensions.ok) {
		return dimensions
	}
	const range = parseRange(params, timezone)
	if (!range.ok) {
		return range
	}
	const granularity = parseGranularity(params, capabilities)
	if (!granularity.ok) {
		return granularity
	}
	const filters = parseFilters(params, capabilities)
	if (!filters.ok) {
		return filters
	}
	const limit = parseLimit(params)
	if (!limit.ok) {
		return limit
	}
	const order = parseOrder(params, metrics.value)
	if (!order.ok) {
		return order
	}

	const rawCompare = readParam(params, 'compare')
	if (rawCompare !== null && rawCompare !== 'previous') {
		return fail('invalid_param', `compare must be "previous": ${echo(rawCompare)}`, 'compare')
	}
	if (rawCompare === 'previous' && !capabilities.comparison) {
		return fail('invalid_param', 'source does not support comparison', 'compare')
	}

	const path = readParam(params, 'path')
	if (path !== null && path.length > MAX_QUERY_PATH_LENGTH) {
		return fail('invalid_param', `path must be at most ${MAX_QUERY_PATH_LENGTH} characters`, 'path')
	}
	const hostname = readParam(params, 'hostname')
	if (hostname !== null && hostname.length > MAX_QUERY_HOSTNAME_LENGTH) {
		return fail(
			'invalid_param',
			`hostname must be at most ${MAX_QUERY_HOSTNAME_LENGTH} characters`,
			'hostname'
		)
	}

	const item = readParam(params, 'item')
	if (item !== null && parseItemRef(item) === null) {
		return fail('invalid_param', `item must be a <collection>:<id> ref: ${echo(item)}`, 'item')
	}
	if (item !== null && capabilities.perItemQuery !== true) {
		return fail('invalid_param', 'source cannot read one item', 'item')
	}

	const unreachable = outOfReach(capabilities, metrics.value, {
		dimensions: dimensions.value,
		filters: filters.value,
		path: path !== null,
	})
	if (unreachable) {
		return unreachable
	}

	const rawTimeframe = readParam(params, 'timeframe')
	if (rawTimeframe !== null && !isTimeframePreset(rawTimeframe)) {
		return fail(
			'invalid_param',
			`timeframe must be one of ${TIMEFRAME_PRESETS.join(', ')}: ${echo(rawTimeframe)}`,
			'timeframe'
		)
	}

	const query: AnalyticsQuery = {
		metrics: metrics.value,
		dateRange: range.value,
		limit: limit.value,
		timezone,
		...(dimensions.value.length > 0 ? { dimensions: dimensions.value } : {}),
		...(granularity.value !== null ? { granularity: granularity.value } : {}),
		...(filters.value.length > 0 ? { filters: filters.value } : {}),
		...(order.value ? { order: order.value } : {}),
		...(path !== null ? { path } : {}),
		...(hostname !== null ? { hostname } : {}),
		...(item !== null ? { item } : {}),
	}
	return {
		ok: true,
		value: {
			query,
			compare: rawCompare === 'previous' ? 'previous' : null,
			timeframe: isTimeframePreset(rawTimeframe) ? rawTimeframe : null,
		},
	}
}
