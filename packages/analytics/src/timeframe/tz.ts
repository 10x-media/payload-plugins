/**
 * IANA-timezone day math, built on `Intl.DateTimeFormat` so there is no dependency.
 * All reporting boundaries (timeframe windows, series axes, native rollup buckets,
 * cache-key day snaps) resolve through these helpers. `startOfDayInTz(d, 'UTC')` is
 * exactly the previous `Date.UTC(...)` day floor, so the default path is unchanged.
 */

export const DEFAULT_TIMEZONE = 'UTC'

interface ZonedParts {
	year: number
	month: number
	day: number
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

/** Wall-clock parts `date` maps to in `tz`. */
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

const sameLocalDay = (
	date: Date,
	ymd: { year: number; month: number; day: number },
	tz: string
): boolean => {
	const p = zonedParts(date, tz)
	return p.year === ymd.year && p.month === ymd.month && p.day === ymd.day
}

/**
 * The first instant of a wall-clock calendar date in `tz`. Usually local midnight; when a
 * spring-forward transition lands exactly at midnight (Chile, Cuba) the 00:00 wall clock
 * does not exist and the refinement below oscillates between the pre- and post-transition
 * offsets, so the candidate that still falls on `ymd` (the transition instant, local
 * 01:00) is taken instead of the refined one that fell back onto the previous day.
 */
const zonedMidnight = (ymd: { year: number; month: number; day: number }, tz: string): Date => {
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
	return zonedMidnight(zonedParts(later, tz), tz)
}

/** Start of `date`'s local day in `tz`. */
export const startOfDayInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return zonedMidnight(p, tz)
}

/** Start of `date`'s local month in `tz`. */
export const startOfMonthInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return zonedMidnight({ year: p.year, month: p.month, day: 1 }, tz)
}

/** Start of `date`'s local year in `tz`. */
export const startOfYearInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	return zonedMidnight({ year: p.year, month: 1, day: 1 }, tz)
}

/**
 * Add `days` calendar days to `date`'s local day in `tz`, returning the resulting day
 * start. The +12h buffer before re-flooring absorbs 23/25-hour DST days so stepping
 * never lands short of, or past, the intended calendar day.
 */
export const addDaysInTz = (date: Date, days: number, tz: string = DEFAULT_TIMEZONE): Date => {
	const start = startOfDayInTz(date, tz)
	return startOfDayInTz(new Date(start.getTime() + days * 86_400_000 + 43_200_000), tz)
}

/**
 * Start of the ISO week (Monday) containing `date`'s local day in `tz`. The weekday of a
 * calendar Y-M-D is timezone-independent, so it is derived from the zoned date and the
 * step back to Monday runs through `addDaysInTz` to stay DST-safe.
 */
export const startOfWeekInTz = (date: Date, tz: string = DEFAULT_TIMEZONE): Date => {
	const p = zonedParts(date, tz)
	const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
	const mondayIndex = (dow + 6) % 7
	return addDaysInTz(startOfDayInTz(date, tz), -mondayIndex, tz)
}

/** ISO string of `date`'s local day start in `tz`; the canonical day-bucket key. */
export const zonedDayIso = (date: Date, tz: string = DEFAULT_TIMEZONE): string =>
	startOfDayInTz(date, tz).toISOString()

/** True when `tz` is a resolvable IANA identifier. */
export const isValidTimeZone = (tz: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return true
	} catch {
		return false
	}
}
