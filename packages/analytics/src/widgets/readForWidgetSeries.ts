import type { PayloadRequest } from 'payload'
import { satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter, AnalyticsRow, DateRange, MetricKey } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { resolveReadContext } from '../core/scopedRead'
import { getRuntime, resolveTimezoneFor } from '../plugin/runtime'
import { resolveTimeframe, type TimeframePreset } from '../timeframe/presets'
import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz, zonedDayIso } from '../timeframe/tz'
import { previousWindow } from './comparison'
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
	/** Previous-window headline total, present only when the adapter supports comparison. */
	previousTotal?: number
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
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

const MAX_SERIES_DAYS = 366

/**
 * Project time-series rows onto a contiguous daily axis, zero-filling gaps. Days are
 * counted in `tz` (defaulting to UTC), so a reporting-timezone read aligns each bucket
 * to that zone's midnight. The axis is capped at the most recent `MAX_SERIES_DAYS` so
 * an unbounded range (all time) stays a bounded, drawable sparkline; the headline total
 * still reflects the full range.
 */
export const fillDailySeries = (args: {
	rows: AnalyticsRow[]
	dateRange: DateRange
	metric: MetricKey
	tz?: string
}): SeriesPoint[] => {
	const { rows, dateRange, metric } = args
	const tz = args.tz ?? DEFAULT_TIMEZONE
	const lastDay = startOfDayInTz(dateRange.end, tz)
	const requestedStart = startOfDayInTz(dateRange.start, tz)
	const byDay = new Map<string, number>()
	for (const row of rows) {
		if (!row.timestamp) {
			continue
		}
		const day = zonedDayIso(new Date(row.timestamp), tz)
		byDay.set(day, (byDay.get(day) ?? 0) + (row.metrics[metric] ?? 0))
	}
	// Walk calendar days back from the last day so DST-length days never mis-step, capping
	// the axis at MAX_SERIES_DAYS or the requested start, whichever is more recent.
	const isoDays: string[] = []
	let cursor = lastDay
	for (let i = 0; i < MAX_SERIES_DAYS && cursor.getTime() >= requestedStart.getTime(); i += 1) {
		isoDays.push(cursor.toISOString())
		cursor = addDaysInTz(cursor, -1, tz)
	}
	return isoDays.reverse().map((date) => ({ date, value: byDay.get(date) ?? 0 }))
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
	const fallback = (status: WidgetReadStatus, id: string): WidgetSeriesResult => ({
		status,
		adapterId: id,
		dateRange: range ?? resolveTimeframe(timeframe, now),
		points: [],
		total: 0,
	})

	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return fallback('unavailable', adapterId ?? '')
	}
	const ctx = await resolveReadContext({ runtime, req, adapterId, scope: args.scope })
	if (!ctx.ok) {
		return fallback('unavailable', adapterId ?? '')
	}
	const tz = await resolveTimezoneFor(runtime, req, ctx.scope)
	const dateRange = range ?? resolveTimeframe(timeframe, now, tz)
	const base = { dateRange, points: [] as SeriesPoint[], total: 0 }
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
		timezone: tz,
		scope: ctx.queryScope,
	})
	let previousTotal: number | undefined
	let comparisonRange: DateRange | undefined
	if (adapter.capabilities.comparison) {
		comparisonRange = previousWindow(dateRange)
		const previous = await runtime.engine.read(adapter, {
			metrics: [metric],
			dateRange: comparisonRange,
			timezone: tz,
			scope: ctx.queryScope,
		})
		previousTotal = previous.totals?.[metric] ?? 0
	}
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		points: fillDailySeries({ rows: result.rows, dateRange, metric, tz }),
		total: result.totals?.[metric] ?? 0,
		clamped: result.meta.clamped ?? false,
		previousTotal,
		comparisonRange,
	}
}
