import type { TimeframePreset } from '../timeframe/presets'
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

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const bucketStart = (d: Date, unit: Unit): Date => {
	if (unit === 'month') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
	if (unit === 'week') {
		const day = startOfUtcDay(d)
		const dow = (day.getUTCDay() + 6) % 7
		day.setUTCDate(day.getUTCDate() - dow)
		return day
	}
	return startOfUtcDay(d)
}

/**
 * Aggregate a daily series into display buckets sized to the timeframe (day for short
 * ranges, week for ~quarter, month for year+), each with a formatted label. Distinct
 * metrics are summed per bucket (a documented daily-uniques approximation).
 */
export const bucketSeries = (
	points: SeriesPoint[],
	timeframe: TimeframePreset,
	_now: Date
): ChartBucket[] => {
	const unit = UNIT_BY_TIMEFRAME[timeframe]
	const weekday = timeframe === 'last7days' || timeframe === 'today'
	const groups = new Map<string, { date: Date; value: number }>()
	for (const p of points) {
		const d = bucketStart(new Date(p.date), unit)
		const key = d.toISOString()
		const g = groups.get(key)
		if (g) {
			g.value += p.value
		} else {
			groups.set(key, { date: d, value: p.value })
		}
	}
	const sorted = [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
	const first = sorted[0]
	const last = sorted.at(-1)
	const multiYear =
		first !== undefined &&
		last !== undefined &&
		first.date.getUTCFullYear() !== last.date.getUTCFullYear()
	const format = (d: Date): string => {
		if (weekday) {
			return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d)
		}
		if (unit === 'month') {
			return new Intl.DateTimeFormat('en-US', {
				month: 'short',
				year: multiYear ? 'numeric' : undefined,
				timeZone: 'UTC',
			}).format(d)
		}
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC',
		}).format(d)
	}
	return sorted.map((g) => ({ label: format(g.date), value: g.value }))
}
