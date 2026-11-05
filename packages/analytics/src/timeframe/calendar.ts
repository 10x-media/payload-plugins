import {
	type CalendarDate,
	DAY_MS,
	DEFAULT_TIMEZONE,
	formatYmd,
	startOfCalendarDayInTz,
	zonedDate,
} from './tz'

/**
 * A calendar date as `yyyymmdd` (20261005). Day arithmetic runs on dates, not instants, so DST
 * never skips or repeats a day; a zone matters only when a day becomes an instant.
 */
export type CalendarDay = number

export const toCalendarDay = ({ year, month, day }: CalendarDate): CalendarDay =>
	year * 10_000 + month * 100 + day

export const calendarDate = (day: CalendarDay): CalendarDate => ({
	year: Math.floor(day / 10_000),
	month: Math.floor(day / 100) % 100,
	day: day % 100,
})

/** Midnight UTC of the date, which is only ever used to step and compare dates. */
const utcMidnight = (day: CalendarDay): number => {
	const { year, month, day: date } = calendarDate(day)
	return Date.UTC(year, month - 1, date)
}

const fromUtcMidnight = (ms: number): CalendarDay => {
	const at = new Date(ms)
	return toCalendarDay({
		year: at.getUTCFullYear(),
		month: at.getUTCMonth() + 1,
		day: at.getUTCDate(),
	})
}

/** Whether a number names a real date (no 20260231). */
export const isCalendarDay = (value: number): boolean =>
	Number.isInteger(value) && value > 0 && fromUtcMidnight(utcMidnight(value)) === value

/** `YYYY-MM-DD`, the form a day-granular provider API and a date input take. */
export const formatCalendarDay = (day: CalendarDay): string => formatYmd(calendarDate(day))

/** The date a `YYYY-MM-DD` string names, or null for anything else. */
export const parseCalendarDay = (text: string): CalendarDay | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
	if (!match) {
		return null
	}
	const day = toCalendarDay({
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
	})
	return isCalendarDay(day) ? day : null
}

/** The local date an instant falls on in `tz`. */
export const calendarDayOf = (instant: Date, tz: string = DEFAULT_TIMEZONE): CalendarDay =>
	toCalendarDay(zonedDate(instant, tz))

export const addCalendarDays = (day: CalendarDay, days: number): CalendarDay =>
	fromUtcMidnight(utcMidnight(day) + days * DAY_MS)

/** Whole days from `from` to `to`; negative when `to` comes first. */
export const calendarDaysBetween = (from: CalendarDay, to: CalendarDay): number =>
	Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS)

/**
 * The Monday starting the week a date belongs to, the same week `startOfWeekInTz` reads: a
 * Sunday closes its week rather than opening the next.
 */
export const weekStartOf = (day: CalendarDay): CalendarDay => {
	const weekday = new Date(utcMidnight(day)).getUTCDay()
	return addCalendarDays(day, -((weekday + 6) % 7))
}

/** The first of the date's month. */
export const monthStartOf = (day: CalendarDay): CalendarDay => Math.floor(day / 100) * 100 + 1

/** The first of the month after the date's. */
export const nextMonthStart = (day: CalendarDay): CalendarDay => {
	const { year, month } = calendarDate(day)
	return month === 12
		? toCalendarDay({ year: year + 1, month: 1, day: 1 })
		: (year * 100 + month + 1) * 100 + 1
}

/** The instant a local date starts at in `tz`, which is not always midnight (Santiago, Havana). */
export const calendarDayStart = (day: CalendarDay, tz: string = DEFAULT_TIMEZONE): Date =>
	startOfCalendarDayInTz(calendarDate(day), tz)
