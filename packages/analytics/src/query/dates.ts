import { addDaysInTz, startOfCalendarDayInTz } from '../timeframe/tz'
import { MIN_QUERY_YEAR } from './limits'

/**
 * Range-bound parsing shared by the query parser, document panel endpoint and stored widget ranges,
 * so none drifts on what a calendar day means.
 */

/** The only offset-free bound form: a `YYYY-MM-DD` calendar day. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Fractional seconds run to nanoseconds because Python emits microseconds; `Date` truncates.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:\d{2})$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean =>
	(year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/**
 * Calendar parts of a `YYYY-MM-DD` string, or null when it names no real day or one before 1970,
 * which `Date.UTC` would also misread for years 0 to 99.
 */
const calendarParts = (raw: string): { year: number; month: number; day: number } | null => {
	const year = Number(raw.slice(0, 4))
	const month = Number(raw.slice(5, 7))
	const day = Number(raw.slice(8, 10))
	if (year < MIN_QUERY_YEAR || month < 1 || month > 12) {
		return null
	}
	const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
	if (lastDay === undefined || day < 1 || day > lastDay) {
		return null
	}
	return { year, month, day }
}

interface BoundArgs {
	/** Reporting timezone a day string is read in; ignored for an instant. */
	timezone: string
	edge: 'start' | 'end'
}

/**
 * A `YYYY-MM-DD` bound spans the whole day in `timezone` (end edge is its last instant, as adapters
 * read `end` inclusively); otherwise only a datetime with `Z` or `±HH:MM` passes.
 */
export const parseDayOrInstant = (raw: string, args: BoundArgs): Date | null => {
	if (DATE_ONLY.test(raw)) {
		const ymd = calendarParts(raw)
		if (!ymd) {
			return null
		}
		const dayStart = startOfCalendarDayInTz(ymd, args.timezone)
		return args.edge === 'start'
			? dayStart
			: new Date(addDaysInTz(dayStart, 1, args.timezone).getTime() - 1)
	}
	const datePart = DATE_TIME.exec(raw)?.[1]
	if (datePart === undefined || !calendarParts(datePart)) {
		return null
	}
	const parsed = new Date(raw)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}
