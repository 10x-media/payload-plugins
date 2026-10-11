import type { DateRange } from '../core/contract'
import { DATE_ONLY, parseDayOrInstant } from '../query/dates'
import { zonedCalendarDay } from '../timeframe/tz'
import { dateTimeFormat } from '../translations/intl'
import type { WidgetRange } from './types'

const NOON_MS = 12 * 3_600_000

/**
 * Calendar day a stored bound names. The `dayOnly` picker stores the browser's local midnight,
 * so a 12-hour shift recovers the picked day for every offset in (-12, +12].
 */
export const pickedDay = (raw: string): string | null => {
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
 * A widget's custom range, inclusive in `timezone`; undefined on a preset, when incomplete, or
 * when a bound names no real day (corrupt widgetData would otherwise throw in the cache key).
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

/**
 * Whether a custom range sets both bounds yet one names no real day or a day before 1970: the
 * widget says the read is invalid rather than reading the last 30 days in its place.
 */
export const isUnreadableCustomRange = (
	timeframe: string | undefined,
	range: WidgetRange | undefined
): boolean =>
	timeframe === 'custom' &&
	Boolean(range?.from && range?.to) &&
	resolveCustomRange(timeframe, range, 'UTC') === undefined

/**
 * Caption for a range as the language writes a span of days ("Jun 1 to 23, 2026"), in the
 * reporting timezone so it names the days that were read, not the server zone's.
 */
export const formatRangeCaption = (range: DateRange, locale: string, timezone: string): string => {
	const format = dateTimeFormat(locale, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: timezone,
	})
	try {
		// Node's ICU writes thin spaces around the span's dash where browsers write plain ones, and
		// the toolbar renders on both sides of a hydration.
		return format.formatRange(range.start, range.end).replace(/[\u2009\u202f]/g, ' ')
	} catch {
		return `${format.format(range.start)} - ${format.format(range.end)}`
	}
}
