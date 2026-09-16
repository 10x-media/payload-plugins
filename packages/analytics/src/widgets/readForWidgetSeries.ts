import type { PayloadRequest } from 'payload'
import { comparisonOf } from '../core/capabilities'
import type {
	AnalyticsFilter,
	AnalyticsResult,
	AnalyticsRow,
	DateRange,
	MetricKey,
} from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz, zonedDayIso } from '../timeframe/tz'
import { previousWindow, withinLookback } from './comparison'
import { prepareWidgetRead, type WidgetReadStatus } from './prepareWidgetRead'
import { readMeta } from './readMeta'

export interface SeriesPoint {
	date: string
	value: number
}

export interface WidgetSeriesResult {
	status: WidgetReadStatus
	adapterId: string
	dateRange: DateRange
	/** Reporting timezone the read resolved in; the trend axis buckets in it. */
	timezone: string
	points: SeriesPoint[]
	total: number
	/** The source that answered, absent on a read that never reached one. */
	provider?: string
	clamped?: boolean
	/** True when the engine served a stale cache entry after a failed provider read. */
	stale?: boolean
	/** True when the source answered without one of the filters the read carried. */
	filtersUnapplied?: boolean
	/** True when the read hit the source's event scan cap, so the numbers are a floor. */
	sampled?: boolean
	/** True when the source could not read the scope's goals, so a conversions series means nothing. */
	goalsUnresolved?: boolean
	/** Previous-window headline total, present only when the adapter supports comparison. */
	previousTotal?: number
	/** The previous comparable window, present only when comparison ran. */
	comparisonRange?: DateRange
	/**
	 * The previous window's daily series, present only when `compare` was asked for and the
	 * adapter supports comparison. Zero-filled to the same length as `points`, so the
	 * previous window's day i overlays `points[i]`.
	 */
	comparisonPoints?: SeriesPoint[]
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
	/**
	 * Reporting timezone the caller already resolved, reused rather than resolved again so
	 * a caller-supplied `range` is read in the very timezone it was interpreted in.
	 */
	timezone?: string
	filters?: AnalyticsFilter[]
	/** Also return the previous window's series, for the chart's comparison overlay. */
	compare?: boolean
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
 * Project a comparison series onto the primary axis: day i of the previous window overlays
 * day i of the current one. Both windows span the same day count by construction, so this
 * only guards a DST-shifted or clamped edge, silently truncating or zero-filling; a filled
 * bucket borrows the axis day so every point still carries a real date.
 */
const alignSeries = (points: SeriesPoint[], axis: SeriesPoint[]): SeriesPoint[] =>
	points.length === axis.length
		? points
		: axis.map((day, i) => points[i] ?? { date: day.date, value: 0 })

/**
 * Site-wide time-series read for a trend widget: resolve the timeframe, pick the
 * adapter, gate on the metric and day-granularity support, read through the engine,
 * then return a zero-filled daily series plus the headline total. Mirrors
 * `readForWidget` but yields points instead of a single value.
 */
export const readForWidgetSeries = async (
	args: ReadForWidgetSeriesArgs
): Promise<WidgetSeriesResult> => {
	const { req, metric, timeframe, adapterId, now, range, filters, compare } = args

	const prepared = await prepareWidgetRead({
		req,
		now,
		timeframe,
		adapterId,
		scope: args.scope,
		timezone: args.timezone,
		range,
		filters,
		requires: { metrics: [metric] },
		granularity: 'day',
		goalRead: () => ({ metrics: [metric] }),
	})
	if (!prepared.ok) {
		return {
			status: prepared.status,
			adapterId: prepared.adapterId,
			dateRange: prepared.dateRange,
			timezone: prepared.tz,
			points: [],
			total: 0,
		}
	}
	const { runtime, adapter, tz, dateRange, goalSlugs } = prepared
	const base = { dateRange, timezone: tz, points: [] as SeriesPoint[], total: 0 }
	const previousRange =
		runtime.comparison && comparisonOf(adapter.capabilities) ? previousWindow(dateRange, tz) : null
	const comparisonRange =
		previousRange &&
		withinLookback(previousRange, adapter.capabilities.maxLookbackDays, { tz, now })
			? previousRange
			: undefined
	const readBase = {
		metrics: [metric],
		filters,
		timezone: tz,
		scope: prepared.queryScope,
		...(goalSlugs === undefined ? {} : { goalSlugs }),
	}
	let result: AnalyticsResult
	let previous: AnalyticsResult | undefined
	try {
		;[result, previous] = await Promise.all([
			runtime.engine.read(adapter, { ...readBase, dateRange, granularity: 'day' }),
			comparisonRange
				? runtime.engine.read(adapter, {
						...readBase,
						dateRange: comparisonRange,
						// The overlay needs the previous window bucketed like the primary; the delta
						// alone only needs its total, so the read stays as it was without `compare`.
						...(compare ? { granularity: 'day' as const } : {}),
					})
				: undefined,
		])
	} catch {
		// No cache entry (fresh or stale) survived the failed read; degrade like an
		// unsupported capability instead of throwing through the widget render tree.
		return { status: 'unavailable', adapterId: adapter.id, ...base }
	}
	const previousTotal = previous ? previous.totals?.[metric] : undefined
	const points = fillDailySeries({ rows: result.rows, dateRange, metric, tz })
	return {
		status: 'ok',
		adapterId: adapter.id,
		dateRange,
		timezone: tz,
		points,
		total: result.totals?.[metric] ?? 0,
		...readMeta(result),
		previousTotal,
		comparisonRange,
		...(compare && previous && comparisonRange
			? {
					comparisonPoints: alignSeries(
						fillDailySeries({ rows: previous.rows, dateRange: comparisonRange, metric, tz }),
						points
					),
				}
			: {}),
	}
}
