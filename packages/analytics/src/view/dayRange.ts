import { parseDayOrInstant } from '../query/dates'
import { MAX_QUERY_RANGE_DAYS } from '../query/limits'
import { formatRangeCaption } from '../widgets/range'
import type { DayRange } from './gating'

const DAY_MS = 86_400_000

/** Epoch ms of a `YYYY-MM-DD` day read as UTC, or null when it is not one. */
const dayValue = (day: string): number | null => {
	const ms = Date.parse(`${day}T00:00:00.000Z`)
	return Number.isNaN(ms) ? null : ms
}

const asDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Calendar days a window covers, counting both ends; 1 for an unreadable or inverted one. */
export const dayRangeDays = (range: DayRange): number => {
	const from = dayValue(range.from)
	const to = dayValue(range.to)
	if (from === null || to === null || to < from) {
		return 1
	}
	return Math.round((to - from) / DAY_MS) + 1
}

/**
 * The nearest window the source and the endpoint can both serve, keeping the bound the
 * admin just picked and moving the other one. A window longer than the source's lookback
 * would answer for a shorter span than the picker shows, and one past the endpoint's own
 * cap would not answer at all.
 */
export const clampDayRange = (
	range: DayRange,
	edited: 'from' | 'to',
	maxDays: number | null
): DayRange => {
	const from = dayValue(range.from)
	const to = dayValue(range.to)
	if (from === null || to === null) {
		return range
	}
	const cap = Math.max(1, Math.min(maxDays ?? MAX_QUERY_RANGE_DAYS, MAX_QUERY_RANGE_DAYS))
	if (to < from) {
		return edited === 'from'
			? { from: range.from, to: range.from }
			: { from: range.to, to: range.to }
	}
	if (Math.round((to - from) / DAY_MS) + 1 <= cap) {
		return range
	}
	return edited === 'from'
		? { from: range.from, to: asDay(from + (cap - 1) * DAY_MS) }
		: { from: asDay(to - (cap - 1) * DAY_MS), to: range.to }
}

/**
 * Caption for a day window, rendered in the reporting timezone the days are read in. Falls
 * back to the raw days when a bound names no calendar day, so a hand-edited URL captions
 * what it asked for rather than rendering `Invalid Date`.
 */
export const dayRangeCaption = (range: DayRange, locale: string, timezone: string): string => {
	const start = parseDayOrInstant(range.from, { timezone, edge: 'start' })
	const end = parseDayOrInstant(range.to, { timezone, edge: 'end' })
	if (!start || !end) {
		return `${range.from} - ${range.to}`
	}
	return formatRangeCaption({ start, end }, locale, timezone)
}
