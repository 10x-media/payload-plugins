import {
	addCalendarDays,
	type CalendarDay,
	calendarDayStart,
	monthStartOf,
	nextMonthStart,
	weekStartOf,
} from '../../timeframe/calendar'
import { addParts, emptyParts, type MetricParts } from '../store/parts'

/** The buckets a series coarser than a day is read in. */
export type CalendarUnit = 'week' | 'month'

/** One local day's parts, the day in the scope's reporting zone. */
export interface DayParts {
	day: CalendarDay
	parts: MetricParts
}

interface BucketParts {
	/** The bucket's first day: a Monday, or the first of a month. */
	start: CalendarDay
	/** How many of its days had parts. */
	days: number
	parts: MetricParts
}

interface FoldedDays {
	/** Every bucket with at least one day, oldest first. */
	buckets: BucketParts[]
	/**
	 * `sumOfDaily` once one bucket added the visitors or sessions of two days: those are counted
	 * per day, so a person who came back on Tuesday is two of a week's visitors.
	 */
	visitorsAre: 'distinct' | 'sumOfDaily'
}

/** The first day of the bucket `day` belongs to; weeks start on Monday, as timeframe presets do. */
export const bucketStartOf = (day: CalendarDay, unit: CalendarUnit): CalendarDay =>
	unit === 'week' ? weekStartOf(day) : monthStartOf(day)

export const nextBucketStart = (start: CalendarDay, unit: CalendarUnit): CalendarDay =>
	unit === 'week' ? addCalendarDays(start, 7) : nextMonthStart(start)

/**
 * The first day of every bucket from the one holding `from` through the one holding `to`, for a
 * caller that draws empty buckets too.
 */
export const bucketStarts = (
	from: CalendarDay,
	to: CalendarDay,
	unit: CalendarUnit
): CalendarDay[] => {
	const starts: CalendarDay[] = []
	const last = bucketStartOf(to, unit)
	for (let start = bucketStartOf(from, unit); start <= last; start = nextBucketStart(start, unit)) {
		starts.push(start)
	}
	return starts
}

/**
 * When a bucket starts, in the reporting zone the days were counted in. A week is not always
 * 168 hours: one holding a daylight saving change is an hour shorter or longer.
 */
export const bucketInstant = (start: CalendarDay, tz: string): Date => calendarDayStart(start, tz)

const countsPeople = (parts: MetricParts): boolean =>
	parts.visitors !== null || parts.sessions !== null

interface OpenBucket {
	parts: MetricParts
	days: Set<CalendarDay>
	daysWithPeople: Set<CalendarDay>
}

/**
 * Every part adds, so averages stay exact, but a person counts once per day (`sumOfDaily`). Rows of
 * one day (one per hostname) add without that caveat: a visitor is hashed per hostname.
 */
export const foldDays = (days: readonly DayParts[], unit: CalendarUnit): FoldedDays => {
	const byStart = new Map<CalendarDay, OpenBucket>()
	for (const { day, parts } of days) {
		const start = bucketStartOf(day, unit)
		const bucket = byStart.get(start) ?? {
			parts: emptyParts(),
			days: new Set<CalendarDay>(),
			daysWithPeople: new Set<CalendarDay>(),
		}
		bucket.parts = addParts(bucket.parts, parts)
		bucket.days.add(day)
		if (countsPeople(parts)) {
			bucket.daysWithPeople.add(day)
		}
		byStart.set(start, bucket)
	}
	const buckets = [...byStart]
		.sort(([a], [b]) => a - b)
		.map(([start, bucket]) => ({ start, days: bucket.days.size, parts: bucket.parts }))
	const summed = [...byStart.values()].some((bucket) => bucket.daysWithPeople.size > 1)
	return { buckets, visitorsAre: summed ? 'sumOfDaily' : 'distinct' }
}
