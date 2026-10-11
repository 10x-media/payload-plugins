import type { PayloadHandler, PayloadRequest } from 'payload'
import { readGate } from '../access/readGate'
import { readReportMode, reportModes } from '../binding/report'
import { currentDate } from '../core/clock'
import type { DateRange, MetricKey } from '../core/contract'
import { isMetricKey } from '../core/guards'
import { describeWithCauses } from '../core/sourceErrors'
import { wholeNumberParam } from '../core/values'
import { ITEM_PANEL_METRICS, ITEM_PANEL_OPTIONAL_METRICS } from '../fields/itemReport'
import { engineReads, readFieldWith } from '../fields/readForDocument'
import { parseDayOrInstant } from '../query/dates'
import { exceedsRangeCap, MAX_QUERY_RANGE_DAYS } from '../query/limits'
import { readDimensionList } from '../query/parse'
import { isTimeframePreset, type TimeframePreset } from '../timeframe/presets'
import { resolveBoundDocument, unloadedDocumentResponse } from './boundDocument'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	notAvailableResponse,
	readDeniedResponse,
	unauthorizedResponse,
	untrustedScopeResponse,
} from './errors'
import { queryParams } from './queryParams'
import { type AnalyticsRuntime, getRuntime, requestTimezone } from './runtime'

const MAX_METRICS = 8
/** A panel row holds three small lists; more would stop being a panel. */
const MAX_PANEL_DIMENSIONS = 3
const MAX_PANEL_ROWS = 25
/** A source with no time per pageview (most vendors) leaves that card out without a warning. */
const PAGE_PANEL_OPTIONAL_METRICS: MetricKey[] = ['avgDuration']

const parseMetrics = (raw: string | null): MetricKey[] | null => {
	if (!raw) {
		return null
	}
	const metrics = raw
		.split(',')
		.map((m) => m.trim())
		.filter(isMetricKey)
	return metrics.length > 0 ? metrics.slice(0, MAX_METRICS) : null
}

type RangeResult =
	| { ok: true; range: DateRange }
	| { ok: false; param: 'from' | 'to'; tooLong?: true }

/**
 * A custom window read like the query endpoint's, capped at `MAX_QUERY_RANGE_DAYS`; a `YYYY-MM-DD`
 * day spans the whole day in the reporting timezone. An inverted window blames `to`, picked second.
 */
const parseRange = (from: string | null, to: string | null, timezone: string): RangeResult => {
	if (!from) {
		return { ok: false, param: 'from' }
	}
	if (!to) {
		return { ok: false, param: 'to' }
	}
	const start = parseDayOrInstant(from, { timezone, edge: 'start' })
	if (!start) {
		return { ok: false, param: 'from' }
	}
	const end = parseDayOrInstant(to, { timezone, edge: 'end' })
	if (!end || end.getTime() <= start.getTime()) {
		return { ok: false, param: 'to' }
	}
	if (exceedsRangeCap({ start, end })) {
		return { ok: false, param: 'to', tooLong: true }
	}
	return { ok: true, range: { start, end } }
}

/**
 * Authenticated GET behind the document panel, in the document's own scope (no parameter names
 * one). Unreadable and missing are one 404; other failures are a logged 500, never a masking 404.
 */
export const makeDocumentHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return unauthorizedResponse()
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return notAvailableResponse()
	}
	try {
		return await answerDocument(req, runtime)
	} catch (err) {
		req.payload.logger?.error(`analytics: document read failed: ${describeWithCauses(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: document read failed'))
	}
}

const answerDocument = async (
	req: PayloadRequest,
	runtime: AnalyticsRuntime
): Promise<Response> => {
	if (!(await readGate(runtime, req))) {
		return readDeniedResponse()
	}
	const params = queryParams(req)
	const collection = params.get('collection') ?? ''
	const id = params.get('id') ?? ''
	if (!runtime.bindings[collection] || !id) {
		return unloadedDocumentResponse(404)
	}
	const rawTimeframe = params.get('timeframe') ?? 'last30days'
	let timezone: string | undefined
	let range: DateRange | undefined
	if (rawTimeframe === 'custom') {
		// Custom bounds name calendar days, so the reporting timezone must resolve before they are
		// read; a preset resolves its window inside `readForField`.
		timezone = await requestTimezone(req)
		const parsed = parseRange(params.get('from'), params.get('to'), timezone)
		if (!parsed.ok) {
			return errorResponse(
				400,
				parsed.tooLong
					? analyticsError(
							'range_too_long',
							`analytics: the range must not exceed ${MAX_QUERY_RANGE_DAYS} days`,
							parsed.param
						)
					: analyticsError(
							'invalid_param',
							'analytics: the custom range could not be read',
							parsed.param
						)
			)
		}
		range = parsed.range
	}
	const timeframe: TimeframePreset = isTimeframePreset(rawTimeframe) ? rawTimeframe : 'last30days'
	const report =
		readReportMode(params.get('report')) ?? reportModes(runtime.bindings[collection])[0] ?? 'page'
	const requested = parseMetrics(params.get('metrics'))
	const metrics =
		requested ??
		(report === 'item' ? ITEM_PANEL_METRICS : ['pageviews', 'visitors', 'sessions', 'avgDuration'])
	// Metrics the panel asked for on spec, so a source serving none of them warns nobody.
	const optionalMetrics =
		parseMetrics(params.get('optional')) ??
		(requested === null
			? report === 'item'
				? ITEM_PANEL_OPTIONAL_METRICS
				: PAGE_PANEL_OPTIONAL_METRICS
			: [])
	const dimensions = readDimensionList(params.get('dimensions'), MAX_PANEL_DIMENSIONS)
	const rawLimit = wholeNumberParam(params.get('limit'))
	const limit = rawLimit === undefined ? undefined : Math.min(Math.max(rawLimit, 1), MAX_PANEL_ROWS)
	const bound = await resolveBoundDocument({ req, collection, id })
	if (!bound.ok) {
		return unloadedDocumentResponse(bound.status)
	}
	// `fresh=1` waits for the source rather than answering with an expired entry: the panel asks it
	// when its first render could only show saved numbers, and falls back to them if the source fails.
	const reads = engineReads({
		priority: 'interactive',
		...(params.get('fresh') === '1' ? { allowStale: false } : {}),
	})
	const result = await readFieldWith(
		{
			req,
			collectionSlug: collection,
			data: bound.data,
			metrics,
			optionalMetrics,
			timeframe,
			range,
			...(timezone !== undefined ? { timezone } : {}),
			...(dimensions.length > 0 ? { dimensions } : {}),
			...(limit === undefined ? {} : { limit }),
			adapterId: params.get('dataSource') ?? undefined,
			now: currentDate(),
			compare: params.get('compare') === '1',
			series: params.get('series') === '1',
			report,
		},
		reads
	)
	if (result.untrustedScope) {
		return untrustedScopeResponse()
	}
	return Response.json(result, { headers: NO_STORE })
}
