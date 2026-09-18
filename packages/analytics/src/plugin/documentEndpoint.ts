import { APIError, type CollectionSlug, type PayloadHandler } from 'payload'
import type { BindingDoc } from '../binding/types'
import type { DateRange, MetricKey } from '../core/contract'
import { readForField } from '../fields/readForDocument'
import { parseDayOrInstant } from '../query/dates'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
import { analyticsError, errorResponse, NO_STORE, RETRY_AFTER } from './errors'
import { DOCUMENT_PATH } from './paths'
import { getRuntime, readAccessFor, requestTimezone } from './runtime'

export { DOCUMENT_PATH }

const KNOWN_METRICS = new Set(Object.keys(METRIC_KEYS) as MetricKey[])
const MAX_METRICS = 8

const parseMetrics = (raw: string | null): MetricKey[] | null => {
	if (!raw) {
		return null
	}
	const metrics = raw
		.split(',')
		.map((m) => m.trim())
		.filter((m): m is MetricKey => KNOWN_METRICS.has(m as MetricKey))
	return metrics.length > 0 ? metrics.slice(0, MAX_METRICS) : null
}

type RangeResult = { ok: true; range: DateRange } | { ok: false; param: 'from' | 'to' }

/**
 * A custom window from the query string, read exactly like the query endpoint's: a
 * `YYYY-MM-DD` day is the whole calendar day in the reporting timezone (`to` inclusive of
 * its final instant), a datetime must carry `Z` or a `±HH:MM` offset, and anything else,
 * including an offset-less datetime, is rejected. `from` equal to `to` is one whole day for
 * day strings and a zero-width window for two instants, so only the latter is rejected. A
 * rejection names the bound at fault, and an inverted window blames `to`: `from` is the one
 * the reader picked first.
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
	return { ok: true, range: { start, end } }
}

/**
 * Authenticated GET handler behind the interactive document analytics panel, gated
 * by `access.read` like every other read endpoint. The caller must also be able to
 * read the target document (enforced through `findByID`
 * without `overrideAccess`), so analytics never leak for content the user cannot
 * see; an unreadable or missing document is a uniform 404, while a read that fails for
 * any other reason is a logged 500 rather than a 404 that hides a broken install.
 * Timeframe, metrics, and data source are whitelist-validated; `timeframe=custom`
 * requires a parseable `from`/`to` pair.
 */
export const makeDocumentHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, analyticsError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return errorResponse(
			503,
			analyticsError('unavailable', 'analytics: not available'),
			RETRY_AFTER
		)
	}
	if (!(await readAccessFor(runtime, req))) {
		return errorResponse(403, analyticsError('forbidden', 'analytics: read access denied'))
	}
	const params = new URL(req.url ?? '', 'http://localhost').searchParams
	const collection = params.get('collection') ?? ''
	const id = params.get('id') ?? ''
	if (!runtime.bindings[collection] || !id) {
		return errorResponse(404, analyticsError('not_found', 'analytics: no such document'))
	}
	const rawTimeframe = params.get('timeframe') ?? 'last30days'
	// Custom bounds name calendar days, so the reporting timezone has to be resolved before
	// they can be read; a preset resolves its window inside `readForField` as before.
	const timezone = rawTimeframe === 'custom' ? await requestTimezone(req) : undefined
	const parsedRange =
		timezone !== undefined ? parseRange(params.get('from'), params.get('to'), timezone) : undefined
	const timeframe: TimeframePreset = TIMEFRAME_PRESETS.includes(rawTimeframe as TimeframePreset)
		? (rawTimeframe as TimeframePreset)
		: 'last30days'
	if (rawTimeframe === 'custom' && parsedRange?.ok !== true) {
		return errorResponse(
			400,
			analyticsError(
				'invalid_param',
				'analytics: the custom range could not be read',
				parsedRange?.ok === false ? parsedRange.param : 'from'
			)
		)
	}
	const range = parsedRange?.ok === true ? parsedRange.range : undefined
	const metrics = parseMetrics(params.get('metrics')) ?? [
		'pageviews',
		'visitors',
		'sessions',
		'avgDuration',
	]
	let data: BindingDoc
	try {
		data = (await req.payload.findByID({
			collection: collection as CollectionSlug,
			id,
			depth: 0,
			overrideAccess: false,
			user: req.user,
			req,
		})) as BindingDoc
	} catch (err) {
		// `findByID` raises a `NotFound` for a missing row and a `Forbidden` for one this
		// caller may not read; both stay a uniform 404 so analytics never confirm a document
		// exists. Anything else is this install failing rather than the request being wrong.
		if (err instanceof APIError && (err.status === 404 || err.status === 403)) {
			return errorResponse(404, analyticsError('not_found', 'analytics: no such document'))
		}
		req.payload.logger?.warn(`analytics: document read failed for "${collection}": ${String(err)}`)
		return errorResponse(500, analyticsError('internal', 'analytics: document read failed'))
	}
	const result = await readForField({
		req,
		collectionSlug: collection,
		data,
		metrics,
		timeframe,
		range: range ?? undefined,
		...(timezone !== undefined ? { timezone } : {}),
		adapterId: params.get('dataSource') ?? undefined,
		now: new Date(),
		compare: params.get('compare') === '1',
		series: params.get('series') === '1',
	})
	return Response.json(result, { headers: NO_STORE })
}
