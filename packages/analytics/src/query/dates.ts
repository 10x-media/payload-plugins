import { addDaysInTz, startOfCalendarDayInTz } from '../timeframe/tz'

/**
 * Range-bound parsing, shared by every surface that takes `from`/`to` from outside: the
 * query endpoint's parser, the document panel endpoint, and the widgets' stored custom
 * range. A leaf module so those cannot drift apart on what a calendar day means.
 */

/** The only offset-free bound form: a `YYYY-MM-DD` calendar day. */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// Fractional seconds run to nanoseconds because Python emits microseconds; `Date` truncates.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:\d{2})$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number): boolean =>
	(year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** Calendar parts of a `YYYY-MM-DD` string, or null when it names no real day. */
const calendarParts = (raw: string): { year: number; month: number; day: number } | null => {
	const year = Number(raw.slice(0, 4))
	const month = Number(raw.slice(5, 7))
	const day = Number(raw.slice(8, 10))
	if (month < 1 || month > 12) {
		return null
	}
	const lastDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]
	if (lastDay === undefined || day < 1 || day > lastDay) {
		return null
	}
	return { year, month, day }
}

export interface BoundArgs {
	/** Reporting timezone a day string is read in; ignored for an instant. */
	timezone: string
	/** Which end of the window this value bounds. */
	edge: 'start' | 'end'
}

/**
 * A range bound. `YYYY-MM-DD` is the whole calendar day in `timezone`: the start edge is
 * its first instant, the end edge its last, matching the inclusive `end` every adapter
 * reads (`less_than_equal`, `timestamp <=`, GA4's inclusive `endDate`). The only other
 * accepted form is a full datetime carrying `Z` or a `±HH:MM` offset, taken as the instant
 * it names. A datetime without an offset is rejected rather than silently read in the
 * server's own zone, and so are the loose forms `Date` would otherwise accept (`2026`,
 * `Sep 1 2026`).
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
