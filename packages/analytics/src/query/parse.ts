import type { SerializedCapabilities } from '../core/capabilities'
import {
	type AnalyticsFilter,
	type AnalyticsQuery,
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
	type Granularity,
	type MetricKey,
} from '../core/contract'
import { GRANULARITY_ORDER } from '../core/granularity'
import { isValidTimeZone } from '../timeframe/tz'
import { METRIC_KEYS } from '../translations/metricKeys'
import { parseDayOrInstant } from './dates'
import { type QueryError, queryError } from './errors'
import {
	DEFAULT_QUERY_LIMIT,
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
}

export type ParseResult = { ok: true; value: ParsedQuery } | { ok: false; error: QueryError }

export interface ParseQueryArgs {
	capabilities: SerializedCapabilities
	/** Reporting timezone the plugin resolved for this request; the `timezone` param overrides it. */
	timezone: string
}

const KNOWN_METRICS = new Set<string>(Object.keys(METRIC_KEYS))
const KNOWN_DIMENSIONS = new Set<string>(DIMENSION_KEYS)
const KNOWN_OPERATORS = new Set<string>(FILTER_OPERATORS)
const KNOWN_GRANULARITIES = new Set<string>(GRANULARITY_ORDER)
const DAY_MS = 86_400_000

const fail = (code: QueryError['code'], message: string, param: string): ParseResult => ({
	ok: false,
	error: queryError(code, message, param),
})

/** Echo a rejected value back in a message without letting a caller inflate the response. */
const echo = (value: string): string => (value.length > 40 ? `${value.slice(0, 40)}...` : value)

/**
 * A trimmed non-empty parameter, or null when absent or blank. Exported so the handler
 * reads `source` and `scope` (which it must resolve before the parser can run) exactly
 * the way the parser reads everything else.
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const parseFilters = (
	raw: string,
	capabilities: SerializedCapabilities
): AnalyticsFilter[] | ParseResult => {
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
	const filterable = new Set<string>(capabilities.filters)
	const operators = new Set<string>(capabilities.filterOperators)
	const parsed: AnalyticsFilter[] = []
	for (const item of decoded) {
		if (!isRecord(item)) {
			return fail('invalid_param', 'each filter must be an object', 'filters')
		}
		const { dimension, operator, value } = item
		if (typeof dimension !== 'string' || !KNOWN_DIMENSIONS.has(dimension)) {
			return fail(
				'invalid_param',
				`unknown filter dimension: ${echo(String(dimension))}`,
				'filters'
			)
		}
		if (typeof operator !== 'string' || !KNOWN_OPERATORS.has(operator)) {
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
		if (!filterable.has(dimension)) {
			return fail('unsupported_filter', `source cannot filter on ${dimension}`, 'filters')
		}
		if (!operators.has(operator)) {
			return fail('unsupported_operator', `source does not support ${operator}`, 'filters')
		}
		parsed.push({
			dimension: dimension as DimensionKey,
			operator: operator as FilterOperator,
			value: trimmed,
		})
	}
	return parsed
}

/**
 * Validate a query string against a source's serialized capabilities. Rules are evaluated
 * in a fixed order and the first failure wins: timezone, metrics, dimensions, from/to,
 * granularity, filters, limit, order, compare, path, hostname. Within each, a value
 * outside the contract's own union is `invalid_param` and a contract value the source
 * lacks is its `unsupported_*` code. Unknown parameters are ignored; `source` and `scope`
 * pass through unvalidated, since only the handler knows whether they are trusted.
 */
export const parseQueryParams = (params: URLSearchParams, args: ParseQueryArgs): ParseResult => {
	const rawTimezone = readParam(params, 'timezone')
	if (rawTimezone !== null && !isValidTimeZone(rawTimezone)) {
		return fail('invalid_param', `unknown timezone: ${echo(rawTimezone)}`, 'timezone')
	}
	const timezone = rawTimezone ?? args.timezone

	const rawMetrics = readParam(params, 'metrics')
	const metricList = rawMetrics ? commaList(rawMetrics) : []
	if (metricList.length === 0) {
		return fail('invalid_param', 'metrics is required', 'metrics')
	}
	const unknownMetric = metricList.find((m) => !KNOWN_METRICS.has(m))
	if (unknownMetric !== undefined) {
		return fail('invalid_param', `unknown metric: ${echo(unknownMetric)}`, 'metrics')
	}
	const metrics = dedupe(metricList) as MetricKey[]
	if (metrics.length > MAX_QUERY_METRICS) {
		return fail('invalid_param', `at most ${MAX_QUERY_METRICS} metrics are allowed`, 'metrics')
	}
	const servedMetrics = new Set<string>(args.capabilities.metrics)
	const unsupportedMetric = metrics.find((m) => !servedMetrics.has(m))
	if (unsupportedMetric !== undefined) {
		return fail('unsupported_metric', `source does not serve ${unsupportedMetric}`, 'metrics')
	}

	const rawDimensions = readParam(params, 'dimensions')
	const dimensionList = rawDimensions ? commaList(rawDimensions) : []
	const unknownDimension = dimensionList.find((d) => !KNOWN_DIMENSIONS.has(d))
	if (unknownDimension !== undefined) {
		return fail('invalid_param', `unknown dimension: ${echo(unknownDimension)}`, 'dimensions')
	}
	const dimensions = dedupe(dimensionList) as DimensionKey[]
	if (dimensions.length > MAX_QUERY_DIMENSIONS) {
		return fail(
			'invalid_param',
			`at most ${MAX_QUERY_DIMENSIONS} dimensions are allowed`,
			'dimensions'
		)
	}
	const servedDimensions = new Set<string>(args.capabilities.dimensions)
	const unsupportedDimension = dimensions.find((d) => !servedDimensions.has(d))
	if (unsupportedDimension !== undefined) {
		return fail(
			'unsupported_dimension',
			`source does not break down by ${unsupportedDimension}`,
			'dimensions'
		)
	}

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
	if (end.getTime() - start.getTime() > MAX_QUERY_RANGE_DAYS * DAY_MS) {
		return fail('range_too_long', `the range must not exceed ${MAX_QUERY_RANGE_DAYS} days`, 'to')
	}

	const rawGranularity = readParam(params, 'granularity')
	if (rawGranularity !== null && !KNOWN_GRANULARITIES.has(rawGranularity)) {
		return fail('invalid_param', `unknown granularity: ${echo(rawGranularity)}`, 'granularity')
	}
	const granularity = rawGranularity as Granularity | null
	if (
		granularity !== null &&
		GRANULARITY_ORDER.indexOf(granularity) <
			GRANULARITY_ORDER.indexOf(args.capabilities.minGranularity)
	) {
		return fail(
			'unsupported_granularity',
			`source buckets no finer than ${args.capabilities.minGranularity}`,
			'granularity'
		)
	}

	const rawFilters = readParam(params, 'filters')
	const filters = rawFilters === null ? [] : parseFilters(rawFilters, args.capabilities)
	if (!Array.isArray(filters)) {
		return filters
	}

	const rawLimit = readParam(params, 'limit')
	let limit = DEFAULT_QUERY_LIMIT
	if (rawLimit !== null) {
		if (!/^\d+$/.test(rawLimit)) {
			return fail('invalid_param', `limit must be an integer: ${echo(rawLimit)}`, 'limit')
		}
		limit = Number(rawLimit)
		if (limit < MIN_QUERY_LIMIT || limit > MAX_QUERY_LIMIT) {
			return fail(
				'invalid_param',
				`limit must be between ${MIN_QUERY_LIMIT} and ${MAX_QUERY_LIMIT}`,
				'limit'
			)
		}
	}

	const rawOrder = readParam(params, 'order')
	let order: AnalyticsQuery['order']
	if (rawOrder !== null) {
		const parts = rawOrder.split(':')
		const metric = parts[0] ?? ''
		const direction = parts[1] ?? ''
		if (parts.length !== 2 || (direction !== 'asc' && direction !== 'desc')) {
			return fail('invalid_param', 'order must be <metric>:<asc|desc>', 'order')
		}
		const ordered = metrics.find((m) => m === metric)
		if (ordered === undefined) {
			return fail('invalid_param', `order metric is not in metrics: ${echo(metric)}`, 'order')
		}
		order = { metric: ordered, direction }
	}

	const rawCompare = readParam(params, 'compare')
	if (rawCompare !== null && rawCompare !== 'previous') {
		return fail('invalid_param', `compare must be "previous": ${echo(rawCompare)}`, 'compare')
	}
	if (rawCompare === 'previous' && !args.capabilities.comparison) {
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

	const query: AnalyticsQuery = {
		metrics,
		dateRange: { start, end },
		limit,
		timezone,
		...(dimensions.length > 0 ? { dimensions } : {}),
		...(granularity !== null ? { granularity } : {}),
		...(filters.length > 0 ? { filters } : {}),
		...(order ? { order } : {}),
		...(path !== null ? { path } : {}),
		...(hostname !== null ? { hostname } : {}),
	}
	return {
		ok: true,
		value: { query, compare: rawCompare === 'previous' ? 'previous' : null },
	}
}
