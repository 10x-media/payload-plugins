/**
 * IANA-timezone day math on `Intl.DateTimeFormat`, with no dependency. Every reporting boundary
 * (windows, series axes, engine days, cache-key snaps) resolves through it.
 */

export const DEFAULT_TIMEZONE = 'UTC'

/** Milliseconds in a UTC day; a local day across a DST change is an hour longer or shorter. */
export const DAY_MS = 86_400_000

export const HOUR_MS = 3_600_000

export const MINUTE_MS = 60_000

/** A wall-clock date, `month` and `day` counted from 1. */
export interface CalendarDate {
	year: number
	month: number
	day: number
}

interface ZonedParts extends CalendarDate {
	hour: number
	minute: number
	second: number
}

// Constructing Intl.DateTimeFormat dominates the cost of these helpers (~14x), and they
// run per event at ingest and in series loops, so formatters are cached per zone.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

const partsFormatter = (tz: string): Intl.DateTimeFormat => {
	let formatter = formatterCache.get(tz)
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		})
		formatterCache.set(tz, formatter)
	}
	return formatter
}

const zonedParts = (date: Date, tz: string): ZonedParts => {
	const map: Record<string, string> = {}
	for (const part of partsFormatter(tz).formatToParts(date)) {
		if (part.type !== 'literal') {
			map[part.type] = part.value
		}
	}
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		hour: Number(map.hour),
		minute: Number(map.minute),
		second: Number(map.second),
	}
}

/** Milliseconds `tz` is ahead of UTC at `date` (positive east of UTC). */
const offsetMs = (date: Date, tz: string): number => {
	const p = zonedParts(date, tz)
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
	// formatToParts drops sub-second precision, so compare against the truncated instant.
	return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

const sameLocalDay = (date: Date, ymd: CalendarDate, tz: string): boolean => {
	const p = zonedParts(date, tz)
	return p.year === ymd.year && p.month === ymd.month && p.day === ymd.day
}

/** Zones found valid: checking one builds a formatter, and a read checks every scope's. */
const validZones = new Set<string>()

const MAX_VALID_ZONES = 1_000

/** Day starts by zone and date: a read over many scopes asks for the same few again and again. */
const dayStarts = new Map<string, number>()

const MAX_DAY_STARTS = 20_000

const dayStartOf = (ymd: CalendarDate, tz: string): Date => {
	const asUtc = Date.UTC(ymd.year, ymd.month - 1, ymd.day)
	const guess = new Date(asUtc - offsetMs(new Date(asUtc), tz))
	const refined = new Date(asUtc - offsetMs(guess, tz))
	if (sameLocalDay(refined, ymd, tz)) {
		return refined
	}
	if (sameLocalDay(guess, ymd, tz)) {
		return guess
	}
	// Neither candidate lands on ymd (the calendar date was skipped entirely, e.g. a
	// dateline change): fall forward to the later candidate's day start.
	const later = refined.getTime() > guess.getTime() ? refined : guess
	return dayStartOf(zonedParts(later, tz), tz)
}

/**
 * First instant of a wall-clock date in `tz`: usually local midnight, but where spring-forward
 * skips 00:00 (Chile, Cuba) it is the transition instant, local 01:00.
 */
export const startOfCalendarDayInTz = (ymd: CalendarDate, tz: string = DEFAULT_TIMEZONE): Date => {
	const key = `${tz} ${ymd.year}-${ymd.month}-${ymd.day}`
	const known = dayStarts.get(key)
	if (known !== undefined) {
		return new Date(known)
	}
	const start = dayStartOf(ymd, tz)
	if (dayStarts.size >= MAX_DAY_STARTS) {
		dayStarts.clear()
	}
	dayStarts.set(key, start.getTime())
	return start
}

export const startOfDayInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return startOfCalendarDayInTz(p, tz)
}

/**
 * Derived from the zoned minute and second, not a UTC hour floor, so half- and quarter-hour zones
 * (India, Nepal, Chatham) bucket on their own hours.
 */
export const startOfHourInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	const ms = date.getTime()
	const intoHour = (p.minute * 60 + p.second) * 1000 + (((ms % 1000) + 1000) % 1000)
	return new Date(ms - intoHour)
}

export const startOfMonthInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return startOfCalendarDayInTz({ year: p.year, month: p.month, day: 1 }, tz)
}

export const startOfYearInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return startOfCalendarDayInTz({ year: p.year, month: 1, day: 1 }, tz)
}

/**
 * Day start `days` calendar days from `date`'s local day in `tz`. The +12h buffer before
 * re-flooring absorbs 23/25-hour DST days.
 */
export const addDaysInTz = (date: Date, days: number, tz: string = DEFAULT_TIMEZONE): Date => {
	const start = startOfDayInTz(date, tz)
	return startOfDayInTz(new Date(start.getTime() + days * DAY_MS + DAY_MS / 2), tz)
}

/**
 * Start of the ISO week (Monday) holding `date`'s local day in `tz`, stepped back through
 * `addDaysInTz` to stay DST-safe.
 */
export const startOfWeekInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
	const mondayIndex = (dow + 6) % 7
	return addDaysInTz(startOfDayInTz(date, tz), -mondayIndex, tz)
}

export const zonedDate = (date: Date, tz: string = DEFAULT_TIMEZONE): CalendarDate => {
	const p = zonedParts(date, tz)
	return { year: p.year, month: p.month, day: p.day }
}

/** A date as `YYYY-MM-DD`. */
export const formatYmd = ({ year, month, day }: CalendarDate): string =>
	`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/**
 * `date`'s local date in `tz` as `YYYY-MM-DD`. Not the local day start's ISO prefix: that is the
 * UTC spelling, a day early for every zone east of UTC.
 */
export const zonedCalendarDay = (date: Date, tz: string = DEFAULT_TIMEZONE): string =>
	formatYmd(zonedParts(date, tz))

/** Whether the runtime's `Intl` knows `tz` as a time zone. */
export const isValidTimeZone = (tz: string): boolean => {
	if (formatterCache.has(tz) || validZones.has(tz)) {
		return true
	}
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
	} catch {
		return false
	}
	if (validZones.size >= MAX_VALID_ZONES) {
		validZones.clear()
	}
	validZones.add(tz)
	return true
}
