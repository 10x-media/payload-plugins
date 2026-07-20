import type { PayloadRequest } from 'payload'
import { resolveHostname, resolvePathCached } from '../binding/resolvePath'
import type { BindingDoc } from '../binding/types'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, DateRange, MetricKey } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { DEFAULT_TIMEZONE } from '../timeframe/tz'
import { previousWindow } from '../widgets/comparison'
import { fillDailySeries, type SeriesPoint } from '../widgets/readForWidgetSeries'

export type FieldReadStatus = 'ok' | 'no-path' | 'not-bound' | 'not-configured' | 'unavailable'

export interface FieldReadResult {
	status: FieldReadStatus
	adapterId: string
	dateRange: DateRange
	/** The reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone: string
	metrics: Partial<Record<MetricKey, number>>
	/** Requested metrics the adapter supports, in request order; the set actually read. */
	supportedMetrics: MetricKey[]
	/** Requested metrics the adapter cannot serve, dropped from the read. */
	droppedMetrics: MetricKey[]
	/** Previous-window totals, present only when comparison was requested and supported. */
	previousMetrics?: Partial<Record<MetricKey, number>>
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
	/** Per-day series for the first supported metric, present only when requested. */
	points?: SeriesPoint[]
}

export interface ReadForFieldArgs {
	req: PayloadRequest
	collectionSlug: string
	data: BindingDoc
	metrics: MetricKey[]
	timeframe: TimeframePreset
	/** Overrides the preset window (custom range). */
	range?: DateRange
	adapterId?: string
	now: Date
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
	/** Also read the previous comparable window when the adapter supports comparison. */
	compare?: boolean
	/** Also read a daily series for the first supported metric when the adapter can. */
	series?: boolean
}

/**
 * Resolve a document's analytics for one display field: look up the runtime, resolve
 * the bound path, capability-gate the requested metrics against the active adapter,
 * then read through the surfacing engine. Returns a discriminated status so the
 * rendering component can show the right empty state without throwing.
 *
 * A metric the adapter does not support is dropped (with one warning per field
 * render), not fatal; `unavailable` is returned only when no requested metric
 * survives or the adapter cannot query per page at all.
 */
export const readForField = async (args: ReadForFieldArgs): Promise<FieldReadResult> => {
	const { req, collectionSlug, data, metrics, timeframe, range, adapterId, now } = args
	let dateRange = range ?? resolveTimeframe(timeframe, now)
	const empty = { metrics: {}, supportedMetrics: [], droppedMetrics: [] }
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return {
			status: 'not-bound',
			adapterId: adapterId ?? '',
			dateRange,
			timezone: DEFAULT_TIMEZONE,
			...empty,
		}
	}
	const binding = runtime.bindings[collectionSlug]
	if (!binding) {
		return {
			status: 'not-bound',
			adapterId: adapterId ?? '',
			dateRange,
			timezone: DEFAULT_TIMEZONE,
			...empty,
		}
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return {
			status: 'unavailable',
			adapterId: adapterId ?? '',
			dateRange,
			timezone: DEFAULT_TIMEZONE,
			...empty,
		}
	}
	const tz = await resolveTimezoneFor(runtime, req, ctx.scope)
	dateRange = range ?? resolveTimeframe(timeframe, now, tz)
	const adapter: AnalyticsAdapter = ctx.adapter
	const bindingCtx = { req, locale: req.locale ?? undefined }
	let path: string | null
	try {
		path = await resolvePathCached(binding, data, bindingCtx)
	} catch {
		path = null
	}
	if (!path) {
		return { status: 'no-path', adapterId: adapter.id, dateRange, timezone: tz, ...empty }
	}
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, dateRange, timezone: tz, ...empty }
	}
	const supportedMetrics = metrics.filter((m) => adapter.capabilities.metrics.has(m))
	const droppedMetrics = metrics.filter((m) => !adapter.capabilities.metrics.has(m))
	if (droppedMetrics.length > 0) {
		req.payload.logger.warn(
			`analytics: adapter "${adapter.id}" does not support metric(s) ${droppedMetrics.join(', ')}; dropped from the "${collectionSlug}" display field`
		)
	}
	if (
		supportedMetrics.length === 0 ||
		!satisfiesCapabilities(adapter.capabilities, { metrics: supportedMetrics, perPageQuery: true })
	) {
		return {
			status: 'unavailable',
			adapterId: adapter.id,
			dateRange,
			timezone: tz,
			metrics: {},
			supportedMetrics: [],
			droppedMetrics: metrics,
		}
	}
	const hostname = await resolveHostname(binding, data, bindingCtx)
	const base = { path, hostname, timezone: tz, scope: ctx.queryScope }
	const comparisonRange =
		args.compare && runtime.comparison && adapter.capabilities.comparison
			? (previousWindow(dateRange, tz) ?? undefined)
			: undefined
	const wantsSeries = args.series && supportsGranularity(adapter.capabilities, 'day')
	const [result, previous, seriesResult] = await Promise.all([
		runtime.engine.read(adapter, { ...base, metrics: supportedMetrics, dateRange }),
		comparisonRange
			? runtime.engine.read(adapter, {
					...base,
					metrics: supportedMetrics,
					dateRange: comparisonRange,
				})
			: undefined,
		wantsSeries
			? runtime.engine.read(adapter, {
					...base,
					metrics: [supportedMetrics[0] as MetricKey],
					dateRange,
					granularity: 'day',
				})
			: undefined,
	])
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		metrics: result.totals ?? {},
		supportedMetrics,
		droppedMetrics,
		previousMetrics: previous ? (previous.totals ?? {}) : undefined,
		comparisonRange,
		points: seriesResult
			? fillDailySeries({
					rows: seriesResult.rows,
					dateRange,
					metric: supportedMetrics[0] as MetricKey,
					tz,
				})
			: undefined,
	}
}
