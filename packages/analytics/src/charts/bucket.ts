import type { DateRange, Granularity, MetricValue } from '../core/contract'
import type { TimeframePreset } from '../timeframe/presets'
import { addDaysInTz, DAY_MS, DEFAULT_TIMEZONE, HOUR_MS, startOfHourInTz } from '../timeframe/tz'
import { dateTimeFormat } from '../translations/intl'
import type { SeriesPoint } from './series'

export interface ChartBucket {
	/** The bucket's period start as an ISO string; identity for React lists. */
	at: string
	label: string
	/** Carries the day an hour tick leaves out; the tooltip reads it instead of `label`. */
	tooltipLabel?: string
	/** `null` when the bucket has no reading: a gap in the line, not a zero. */
	value: MetricValue
	/** An hour the day has not reached yet: it holds its place on the axis and nothing more. */
	upcoming?: boolean
}

export type BucketUnit = 'hour' | 'day' | 'week' | 'month'

const UNIT_BY_TIMEFRAME: Record<TimeframePreset, BucketUnit> = {
	today: 'hour',
	last7days: 'day',
	last30days: 'day',
	thisMonth: 'day',
	last90days: 'week',
	thisYear: 'month',
	lastYear: 'month',
	allTime: 'month',
}

const DEFAULT_LOCALE = 'en-US'

/**
 * The unit a preset's chart buckets on. `hour` needs an hourly series: a daily one has a single
 * point there, so a source without hourly rows has no chart.
 */
export const unitForTimeframe = (timeframe: TimeframePreset): BucketUnit =>
	UNIT_BY_TIMEFRAME[timeframe]

/**
 * The unit a window's series is read and charted at: a window of two days or less by hour,
 * short ranges by day, a quarter by week, longer by month.
 */
export const unitForRange = (range: DateRange): BucketUnit => {
	const spanDays = Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS)
	return spanDays <= 2 ? 'hour' : spanDays <= 31 ? 'day' : spanDays <= 120 ? 'week' : 'month'
}

export interface BucketLabelOptions {
	/** The bucket the series was read at; the label only names it. */
	granularity: Granularity
	/** Reporting timezone the buckets start in; defaults to UTC. */
	tz?: string
	/** The reader's locale, from `i18n.language` on either side; defaults to `en-US`. */
	locale?: string
	/** Name each day by its weekday, as the fixed 7-day preset does. */
	weekday?: boolean
	/** A month always names its year; without it, only a series that spans two years does. */
	year?: 'always' | 'auto'
	/**
	 * The window's first instant. A bucket starting before it, the week from the Monday before
	 * the range or the month from its first, is named by the day the range starts instead.
	 */
	from?: Date
}

const yearOf = (at: Date, locale: string, timeZone: string): string =>
	dateTimeFormat(locale, { year: 'numeric', timeZone }).format(at)

/** One bucket's axis label, from its start in the reporting timezone (or `from`, if later). */
export const bucketLabel = (
	start: Date,
	{
		granularity,
		tz: timeZone = DEFAULT_TIMEZONE,
		locale = DEFAULT_LOCALE,
		weekday,
		from,
	}: BucketLabelOptions,
	withYear = false
): string => {
	const at = from !== undefined && start.getTime() < from.getTime() ? from : start
	if (granularity === 'minute') {
		return dateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(at)
	}
	if (granularity === 'hour') {
		return dateTimeFormat(locale, { hour: 'numeric', timeZone }).format(at)
	}
	if (granularity === 'day' && weekday === true) {
		return dateTimeFormat(locale, { weekday: 'short', timeZone }).format(at)
	}
	if (granularity === 'month') {
		return dateTimeFormat(locale, {
			month: 'short',
			...(withYear ? { year: 'numeric' } : {}),
			timeZone,
		}).format(at)
	}
	return dateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(at)
}

/**
 * The day an hour tick leaves out, so a two-day window's tooltip still says which "9 AM" it is.
 * Every coarser bucket's tick already identifies itself, and reads undefined here.
 */
export const bucketTooltipLabel = (
	at: Date,
	{ granularity, tz = DEFAULT_TIMEZONE, locale = DEFAULT_LOCALE }: BucketLabelOptions
): string | undefined =>
	granularity === 'hour'
		? dateTimeFormat(locale, { weekday: 'short', hour: 'numeric', timeZone: tz }).format(at)
		: undefined

/** Whether a month axis needs its years: always on request, else when the series crosses one. */
const monthsNeedYear = (dates: Date[], options: BucketLabelOptions): boolean => {
	if (options.granularity !== 'month') {
		return false
	}
	if (options.year === 'always') {
		return true
	}
	const locale = options.locale ?? DEFAULT_LOCALE
	const tz = options.tz ?? DEFAULT_TIMEZONE
	return new Set(dates.map((at) => yearOf(at, locale, tz))).size > 1
}

/** A bucket's axis label and, for an hour, the tooltip label naming its day. */
const labelsOf = (
	start: Date,
	options: BucketLabelOptions,
	withYear = false
): Pick<ChartBucket, 'label' | 'tooltipLabel'> => {
	const tooltipLabel = bucketTooltipLabel(start, options)
	return {
		label: bucketLabel(start, options, withYear),
		...(tooltipLabel === undefined ? {} : { tooltipLabel }),
	}
}
/** A day holds at most 25 hours, the one a clock falls back in. */
const MAX_DAY_HOURS = 25

/**
 * The hours after `last` to the end of its day in the reporting timezone, marked upcoming, so a day
 * under way keeps its whole axis.
 */
export const upcomingHours = (last: Date, options: BucketLabelOptions): ChartBucket[] => {
	const tz = options.tz ?? DEFAULT_TIMEZONE
	const hourly: BucketLabelOptions = { ...options, granularity: 'hour' }
	const dayEnd = addDaysInTz(last, 1, tz).getTime()
	const hours: ChartBucket[] = []
	let at = startOfHourInTz(new Date(last.getTime() + HOUR_MS), tz)
	while (at.getTime() < dayEnd && hours.length < MAX_DAY_HOURS) {
		hours.push({ at: at.toISOString(), ...labelsOf(at, hourly), value: null, upcoming: true })
		at = startOfHourInTz(new Date(at.getTime() + HOUR_MS), tz)
	}
	return hours
}

/**
 * Labels a series the engine already bucketed and summed, one chart bucket per point named by its
 * start in the reporting timezone; an hourly series runs on to its day's end via {@link upcomingHours}.
 */
export const labelSeries = (points: SeriesPoint[], options: BucketLabelOptions): ChartBucket[] => {
	const dates = points.map((point) => new Date(point.date))
	const withYear = monthsNeedYear(dates, options)
	const labeled = points.map(
		(point, i): ChartBucket => ({
			at: point.date,
			...labelsOf(dates[i] ?? new Date(point.date), options, withYear),
			value: point.value,
		})
	)
	const last = dates.at(-1)
	return options.granularity === 'hour' && last !== undefined
		? [...labeled, ...upcomingHours(last, options)]
		: labeled
}
