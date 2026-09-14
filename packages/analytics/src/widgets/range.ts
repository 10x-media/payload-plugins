import type { DateRange } from '../core/contract'
import { DATE_ONLY, parseDayOrInstant } from '../query/dates'
import { zonedCalendarDay } from '../timeframe/tz'
import type { WidgetRange } from './types'

const NOON_MS = 12 * 3_600_000

/**
 * The calendar day a stored bound names. The `dayOnly` picker stores the picked day at the
 * admin browser's local midnight, so the instant lands on that day or the one before it in
 * UTC depending on the browser's offset; a 12-hour shift recovers the picked day for every
 * offset in (-12, +12]. Zones at +12:45 and beyond (Chatham in DST, Kiritimati) recover the
 * day before, and the uninhabited UTC-12 the day after.
 */
const pickedDay = (raw: string): string | null => {
	if (DATE_ONLY.test(raw)) {
		return raw
	}
	const instant = new Date(raw)
	if (Number.isNaN(instant.getTime())) {
		return null
	}
	return zonedCalendarDay(new Date(instant.getTime() + NOON_MS), 'UTC')
}

/**
 * Resolve a widget's explicit custom range to a concrete DateRange, or undefined when the
 * widget is on a relative preset, the custom range is incomplete, or either bound names no
 * real day (a corrupt or hand-set widgetData would otherwise reach the cache key and throw
 * on `toISOString`). The two picked days are read inclusively in `timezone`, the reporting
 * timezone the read resolves in: `from` at the first instant of its day, `to` at the last.
 */
export const resolveCustomRange = (
	timeframe: string | undefined,
	range: WidgetRange | undefined,
	timezone: string
): DateRange | undefined => {
	if (timeframe !== 'custom' || !range?.from || !range?.to) {
		return undefined
	}
	const fromDay = pickedDay(range.from)
	const toDay = pickedDay(range.to)
	if (!fromDay || !toDay) {
		return undefined
	}
	const start = parseDayOrInstant(fromDay, { timezone, edge: 'start' })
	const end = parseDayOrInstant(toDay, { timezone, edge: 'end' })
	if (!start || !end) {
		return undefined
	}
	return { start, end }
}

const formatDay = (d: Date, locale: string, timeZone: string): string =>
	d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone })

/**
 * Server-side caption for a custom range, e.g. "Jun 1, 2026 - Jun 23, 2026". Both bounds
 * render in the reporting timezone, so the caption names the days that were read rather
 * than the days the server's own zone would spell them as.
 */
export const formatRangeCaption = (range: DateRange, locale: string, timezone: string): string =>
	`${formatDay(range.start, locale, timezone)} - ${formatDay(range.end, locale, timezone)}`
