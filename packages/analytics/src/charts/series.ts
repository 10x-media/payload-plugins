import type {
	AnalyticsCapabilities,
	AnalyticsRow,
	DateRange,
	MetricKey,
	MetricValue,
} from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { combineMetricValues, emptyReading } from '../core/metricValues'
import { bucketStartOf, bucketStarts, type CalendarUnit } from '../native/engine/buckets'
import { dayOfTimestamp } from '../surfacing/rebucket'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../timeframe/calendar'
import {
	addDaysInTz,
	DEFAULT_TIMEZONE,
	HOUR_MS,
	startOfDayInTz,
	startOfHourInTz,
} from '../timeframe/tz'
import { unitForRange } from './bucket'

export interface SeriesPoint {
	date: string
	/** `null` for an average with nothing to average over in this bucket: a gap, not a zero. */
	value: MetricValue
}

/**
 * The buckets a trend series is read at. Weeks and months come folded and weighted from the engine;
 * the browser only labels them.
 */
export type SeriesGranularity = 'hour' | 'day' | 'week' | 'month'

const MAX_SERIES_DAYS = 366
const MAX_SERIES_HOURS = 60

/** A series to fill: rows read over `dateRange`, bucketed in `tz` (UTC when left out). */
export interface FillSeriesArgs {
	rows: AnalyticsRow[]
	dateRange: DateRange
	metric: MetricKey
	tz?: string
	/**
	 * Every bucket of the range, past the widgets' caps (60 hours, 366 days), for the analytics view,
	 * whose reader picks the bucket.
	 */
	uncapped?: boolean
}

/**
 * Every row's reading of `metric`, grouped by the bucket `keyOf` assigns it (none, for a timestamp
 * it cannot read) and folded by the metric's own rule: counts add up, averages are averaged.
 */
const readingsBy = (
	rows: AnalyticsRow[],
	metric: MetricKey,
	keyOf: (timestamp: string) => string | null
): Map<string, MetricValue> => {
	const grouped = new Map<string, MetricValue[]>()
	for (const row of rows) {
		const key = row.timestamp ? keyOf(row.timestamp) : null
		if (key === null) {
			continue
		}
		const reading = row.metrics[metric] ?? emptyReading(metric)
		const readings = grouped.get(key)
		if (readings) {
			readings.push(reading)
		} else {
			grouped.set(key, [reading])
		}
	}
	return new Map(
		[...grouped].map(([key, readings]) => [key, combineMetricValues(metric, readings)])
	)
}

/** `last` and each `back` step from it not before `first`, at most `most` of them, oldest first. */
const instantsBack = ({
	last,
	first,
	most,
	back,
}: {
	last: Date
	first: Date
	most: number
	back: (at: Date) => Date
}): string[] => {
	const instants: string[] = []
	for (let at = last; instants.length < most && at.getTime() >= first.getTime(); at = back(at)) {
		instants.push(at.toISOString())
	}
	return instants.reverse()
}

/** Each bucket of `axis` with its reading, an empty one reading zero (or a gap, for an average). */
const pointsOn = (
	axis: string[],
	readings: Map<string, MetricValue>,
	metric: MetricKey
): SeriesPoint[] =>
	axis.map((date) => ({ date, value: readings.get(date) ?? emptyReading(metric) }))

/**
 * Rows on a gapless daily axis in `tz`, a gap reading zero for a count and `null` for an average.
 * Only the latest `MAX_SERIES_DAYS` are drawn; the headline total still covers the whole range.
 */
export const fillDailySeries = (args: FillSeriesArgs): SeriesPoint[] => {
	const { rows, dateRange, metric } = args
	const tz = args.tz ?? DEFAULT_TIMEZONE
	const byDay = readingsBy(rows, metric, (timestamp) => {
		const day = dayOfTimestamp(timestamp, tz)
		return day === null ? null : calendarDayStart(day, tz).toISOString()
	})
	// Stepped back by calendar day, so a day a DST change lengthens or shortens never mis-steps.
	const days = instantsBack({
		last: startOfDayInTz(dateRange.end, tz),
		first: startOfDayInTz(dateRange.start, tz),
		most: args.uncapped === true ? Number.POSITIVE_INFINITY : MAX_SERIES_DAYS,
		back: (day) => addDaysInTz(day, -1, tz),
	})
	return pointsOn(days, byDay, metric)
}

/**
 * Rows on a gapless hourly axis floored in `tz`, re-floored every step so a half-hour zone or a DST
 * change inside the window never leaves the axis off the hour.
 */
export const fillHourlySeries = (args: FillSeriesArgs): SeriesPoint[] => {
	const { rows, dateRange, metric } = args
	const tz = args.tz ?? DEFAULT_TIMEZONE
	const byHour = readingsBy(rows, metric, (timestamp) =>
		startOfHourInTz(new Date(timestamp), tz).toISOString()
	)
	const hours = instantsBack({
		last: startOfHourInTz(dateRange.end, tz),
		first: startOfHourInTz(dateRange.start, tz),
		most: args.uncapped === true ? Number.POSITIVE_INFINITY : MAX_SERIES_HOURS,
		back: (hour) => startOfHourInTz(new Date(hour.getTime() - HOUR_MS), tz),
	})
	return pointsOn(hours, byHour, metric)
}

/**
 * Rows on a gapless axis of weeks (from Monday) or months in `tz`, each filed under the bucket its
 * date falls in, over the same latest `MAX_SERIES_DAYS` as the daily axis.
 */
export const fillCalendarSeries = (
	args: FillSeriesArgs & { unit: CalendarUnit }
): SeriesPoint[] => {
	const { rows, dateRange, metric, unit } = args
	const tz = args.tz ?? DEFAULT_TIMEZONE
	const lastDay = calendarDayOf(dateRange.end, tz)
	const requested = calendarDayOf(dateRange.start, tz)
	const capped = addCalendarDays(lastDay, -(MAX_SERIES_DAYS - 1))
	const firstDay = requested > capped || args.uncapped === true ? requested : capped
	const byBucket = readingsBy(rows, metric, (timestamp) => {
		const day = dayOfTimestamp(timestamp, tz)
		return day === null ? null : calendarDayStart(bucketStartOf(day, unit), tz).toISOString()
	})
	const buckets = bucketStarts(firstDay, lastDay, unit).map((start) =>
		calendarDayStart(start, tz).toISOString()
	)
	return pointsOn(buckets, byBucket, metric)
}

/**
 * The bucket a widget's or field's series is read at: hours up to two days, days to a month, weeks
 * to four months, then months. A source without hourly rows falls back to a day.
 */
export const seriesGranularityFor = (
	dateRange: DateRange,
	caps: AnalyticsCapabilities
): SeriesGranularity => {
	const unit = unitForRange(dateRange)
	if (unit === 'hour') {
		return supportsGranularity(caps, 'hour') ? 'hour' : 'day'
	}
	return unit
}

/** Whether a bucket is one {@link fillSeries} draws a gapless axis of. */
export const isSeriesGranularity = (granularity: string): granularity is SeriesGranularity =>
	granularity === 'hour' ||
	granularity === 'day' ||
	granularity === 'week' ||
	granularity === 'month'

/**
 * Fill a series onto the contiguous axis its granularity implies: every bucket of the range in
 * `tz`, an empty one reading zero (or a gap, for an average), and nothing outside the range.
 */
export const fillSeries = (
	args: FillSeriesArgs & { granularity: SeriesGranularity }
): SeriesPoint[] => {
	const { granularity } = args
	if (granularity === 'hour') {
		return fillHourlySeries(args)
	}
	if (granularity === 'day') {
		return fillDailySeries(args)
	}
	return fillCalendarSeries({ ...args, unit: granularity })
}

/**
 * Lays a comparison series over the primary axis bucket by bucket, truncated or filled to its length;
 * a filled bucket borrows the axis date so every point carries a real one.
 */
export const alignSeries = (
	points: SeriesPoint[],
	axis: SeriesPoint[],
	metric: MetricKey
): SeriesPoint[] =>
	points.length === axis.length
		? points
		: axis.map((day, i) => points[i] ?? { date: day.date, value: emptyReading(metric) })
