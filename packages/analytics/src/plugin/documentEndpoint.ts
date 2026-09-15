import type { CollectionSlug, PayloadHandler } from 'payload'
import type { BindingDoc } from '../binding/types'
import type { DateRange, MetricKey } from '../core/contract'
import { readForField } from '../fields/readForDocument'
import { parseDayOrInstant } from '../query/dates'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
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

/**
 * A custom window from the query string, read exactly like the query endpoint's: a
 * `YYYY-MM-DD` day is the whole calendar day in the reporting timezone (`to` inclusive of
 * its final instant), a datetime must carry `Z` or a `±HH:MM` offset, and anything else,
 * including an offset-less datetime, is rejected. `from` equal to `to` is one whole day for
 * day strings and a zero-width window for two instants, so only the latter is rejected.
 */
const parseRange = (from: string | null, to: string | null, timezone: string): DateRange | null => {
	if (!from || !to) {
		return null
	}
	const start = parseDayOrInstant(from, { timezone, edge: 'start' })
	const end = parseDayOrInstant(to, { timezone, edge: 'end' })
	if (!start || !end || end.getTime() <= start.getTime()) {
		return null
	}
	return { start, end }
}

/**
 * Authenticated GET handler behind the interactive document analytics panel, gated
 * by `access.read` like every other read endpoint. The caller must also be able to
 * read the target document (enforced through `findByID`
 * without `overrideAccess`), so analytics never leak for content the user cannot
 * see; an unreadable or missing document is a uniform 404. Timeframe, metrics, and
 * data source are whitelist-validated; `timeframe=custom` requires a parseable
 * `from`/`to` pair.
 */
export const makeDocumentHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return Response.json({ error: 'unauthorized' }, { status: 401 })
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return Response.json({ error: 'unavailable' }, { status: 503 })
	}
	if (!(await readAccessFor(runtime, req))) {
		return Response.json({ error: 'forbidden' }, { status: 403 })
	}
	const params = new URL(req.url ?? '', 'http://localhost').searchParams
	const collection = params.get('collection') ?? ''
	const id = params.get('id') ?? ''
	if (!runtime.bindings[collection] || !id) {
		return Response.json({ error: 'not found' }, { status: 404 })
	}
	const rawTimeframe = params.get('timeframe') ?? 'last30days'
	// Custom bounds name calendar days, so the reporting timezone has to be resolved before
	// they can be read; a preset resolves its window inside `readForField` as before.
	const timezone = rawTimeframe === 'custom' ? await requestTimezone(req) : undefined
	const range =
		timezone !== undefined ? parseRange(params.get('from'), params.get('to'), timezone) : undefined
	const timeframe: TimeframePreset = TIMEFRAME_PRESETS.includes(rawTimeframe as TimeframePreset)
		? (rawTimeframe as TimeframePreset)
		: 'last30days'
	if (rawTimeframe === 'custom' && !range) {
		return Response.json({ error: 'invalid range' }, { status: 400 })
	}
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
	} catch {
		return Response.json({ error: 'not found' }, { status: 404 })
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
	return Response.json(result)
}
