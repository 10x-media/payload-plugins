import type { CollectionSlug, PayloadHandler } from 'payload'
import type { BindingDoc } from '../binding/types'
import type { DateRange, MetricKey } from '../core/contract'
import { readForField } from '../fields/readForDocument'
import { TIMEFRAME_PRESETS, type TimeframePreset } from '../timeframe/presets'
import { METRIC_KEYS } from '../translations/metricKeys'
import { DOCUMENT_PATH } from './paths'
import { getRuntime } from './runtime'

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

const parseRange = (from: string | null, to: string | null): DateRange | null => {
	if (!from || !to) {
		return null
	}
	const start = new Date(from)
	const end = new Date(to)
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
		return null
	}
	return { start, end }
}

/**
 * Authenticated GET handler behind the interactive document analytics panel. The
 * caller must be able to read the target document (enforced through `findByID`
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
	const params = new URL(req.url ?? '', 'http://localhost').searchParams
	const collection = params.get('collection') ?? ''
	const id = params.get('id') ?? ''
	if (!runtime.bindings[collection] || !id) {
		return Response.json({ error: 'not found' }, { status: 404 })
	}
	const rawTimeframe = params.get('timeframe') ?? 'last30days'
	const range =
		rawTimeframe === 'custom' ? parseRange(params.get('from'), params.get('to')) : undefined
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
		adapterId: params.get('dataSource') ?? undefined,
		now: new Date(),
		compare: params.get('compare') === '1',
		series: params.get('series') === '1',
	})
	return Response.json(result)
}
