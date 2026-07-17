import type { DateRange } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import {
	DEFAULT_TIMEZONE,
	startOfDayInTz,
	startOfMonthInTz,
	startOfWeekInTz,
} from '../timeframe/tz'
import type { SeriesPoint } from '../widgets/readForWidgetSeries'

export interface ChartBucket {
	label: string
	value: number
}

type Unit = 'day' | 'week' | 'month'

const UNIT_BY_TIMEFRAME: Record<TimeframePreset, Unit> = {
	today: 'day',
	last7days: 'day',
	last30days: 'day',
	thisMonth: 'day',
	last90days: 'week',
	thisYear: 'month',
	lastYear: 'month',
	allTime: 'month',
}

const bucketStart = (d: Date, unit: Unit, tz: string): Date => {
	if (unit === 'month') return startOfMonthInTz(d, tz)
	if (unit === 'week') return startOfWeekInTz(d, tz)
	return startOfDayInTz(d, tz)
}

interface BucketConfig {
	unit: Unit
	/** Label each bucket by weekday (only the fixed 7-day / today presets). */
	weekday: boolean
	tz: string
}

const bucketByUnit = (
	points: SeriesPoint[],
	{ unit, weekday, tz }: BucketConfig
): ChartBucket[] => {
	const groups = new Map<string, { date: Date; value: number }>()
	for (const p of points) {
		const d = bucketStart(new Date(p.date), unit, tz)
		const key = d.toISOString()
		const g = groups.get(key)
		if (g) {
			g.value += p.value
		} else {
			groups.set(key, { date: d, value: p.value })
		}
	}
	const sorted = [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
	// The label reads each bucket's start in the reporting timezone, so a zone whose day
	// starts fall on the previous UTC calendar day still labels the correct local date.
	const years = new Set(
		sorted.map((g) =>
			new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz }).format(g.date)
		)
	)
	const multiYear = years.size > 1
	const format = (d: Date): string => {
		if (weekday) {
			return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d)
		}
		if (unit === 'month') {
			return new Intl.DateTimeFormat('en-US', {
				month: 'short',
				year: multiYear ? 'numeric' : undefined,
				timeZone: tz,
			}).format(d)
		}
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: tz,
		}).format(d)
	}
	return sorted.map((g) => ({ label: format(g.date), value: g.value }))
}

/**
 * Aggregate a daily series into display buckets sized to the timeframe (day for short
 * ranges, week for ~quarter, month for year+), each with a formatted label. Buckets and
 * labels resolve in `tz` (defaulting to UTC) so the axis lines up with the reporting
 * timezone the series and comparison windows are aligned to. Distinct metrics are summed
 * per bucket (a documented daily-uniques approximation).
 */
export const bucketSeries = (
	points: SeriesPoint[],
	timeframe: TimeframePreset,
	tz: string = DEFAULT_TIMEZONE
): ChartBucket[] =>
	bucketByUnit(points, {
		unit: UNIT_BY_TIMEFRAME[timeframe],
		weekday: timeframe === 'last7days' || timeframe === 'today',
		tz,
	})

const DAY = 86_400_000

const unitForSpan = (spanDays: number): Unit =>
	spanDays <= 31 ? 'day' : spanDays <= 120 ? 'week' : 'month'

/**
 * Bucket a daily series for a custom (arbitrary) range, choosing the bucket unit from
 * the span the way the presets do: short ranges by day, a quarter by week, longer by
 * month. Buckets resolve in `tz` (defaulting to UTC); weekday labels are only used for
 * the fixed 7-day preset, never here.
 */
export const bucketByRange = (
	points: SeriesPoint[],
	range: DateRange,
	tz: string = DEFAULT_TIMEZONE
): ChartBucket[] => {
	const spanDays = Math.round((range.end.getTime() - range.start.getTime()) / DAY)
	return bucketByUnit(points, { unit: unitForSpan(spanDays), weekday: false, tz })
}
