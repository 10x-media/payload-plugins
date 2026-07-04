import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, AnalyticsRow, DateRange, MetricKey } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import type { WidgetReadStatus } from './readForWidget'

export interface SeriesPoint {
	date: string
	value: number
}

export interface WidgetSeriesResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	points: SeriesPoint[]
	total: number
	clamped?: boolean
}

export interface ReadForWidgetSeriesArgs {
	req: PayloadRequest
	metric: MetricKey
	timeframe: TimeframePreset
	adapterId?: string
	now: Date
	range?: DateRange
	/** Explicit scope override; omitted resolves via the plugin's scopeResolver. */
	scope?: string | null
}

const DAY_MS = 86_400_000
const MAX_SERIES_DAYS = 366

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/**
 * Project time-series rows onto a contiguous daily axis, zero-filling gaps. The axis
 * is capped at the most recent `MAX_SERIES_DAYS` so an unbounded range (all time)
 * stays a bounded, drawable sparkline; the headline total still reflects the full
 * range.
 */
export const fillDailySeries = (
	rows: AnalyticsRow[],
	dateRange: DateRange,
	metric: MetricKey
): SeriesPoint[] => {
	const lastDay = startOfUtcDay(dateRange.end)
	const requestedStart = startOfUtcDay(dateRange.start)
	const floor = new Date(lastDay.getTime() - (MAX_SERIES_DAYS - 1) * DAY_MS)
	const firstDay = requestedStart.getTime() > floor.getTime() ? requestedStart : floor
	const byDay = new Map<string, number>()
	for (const row of rows) {
		if (!row.timestamp) {
			continue
		}
		const day = startOfUtcDay(new Date(row.timestamp)).toISOString()
		byDay.set(day, (byDay.get(day) ?? 0) + (row.metrics[metric] ?? 0))
	}
	const points: SeriesPoint[] = []
	for (let t = firstDay.getTime(); t <= lastDay.getTime(); t += DAY_MS) {
		const date = new Date(t).toISOString()
		points.push({ date, value: byDay.get(date) ?? 0 })
	}
	return points
}

/**
 * Site-wide time-series read for a trend widget: resolve the timeframe, pick the
 * adapter, gate on the metric and day-granularity support, read through the engine,
 * then return a zero-filled daily series plus the headline total. Mirrors
 * `readForWidget` but yields points instead of a single value.
 */
export const readForWidgetSeries = async (
	args: ReadForWidgetSeriesArgs
): Promise<WidgetSeriesResult> => {
	const { req, metric, timeframe, adapterId, now, range } = args
	const dateRange = range ?? resolveTimeframe(timeframe, now)
	const base = { dateRange, points: [] as SeriesPoint[], total: 0 }

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return { status: 'unavailable', adapterId: adapterId ?? '', ...base }
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return { status: 'unavailable', adapterId: adapterId ?? '', ...base }
	}
	const adapter: AnalyticsAdapter = ctx.adapter
	if (!adapter.isConfigured()) {
		return { status: 'not-configured', adapterId: adapter.id, ...base }
	}
	if (
		!satisfiesCapabilities(adapter.capabilities, { metrics: [metric] }) ||
		!supportsGranularity(adapter.capabilities, 'day')
	) {
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const result = await runtime.engine.read(adapter, {
		metrics: [metric],
		dateRange,
		granularity: 'day',
		scope: ctx.queryScope,
	})
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		points: fillDailySeries(result.rows, dateRange, metric),
		total: result.totals?.[metric] ?? 0,
		clamped: result.meta.clamped ?? false,
	}
}
