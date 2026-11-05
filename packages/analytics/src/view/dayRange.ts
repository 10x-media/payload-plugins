import { parseDayOrInstant } from '../query/dates'
import { MAX_QUERY_RANGE_DAYS } from '../query/limits'
import { DAY_MS } from '../timeframe/tz'
import { formatRangeCaption } from '../widgets/range'
import type { DayRange } from './gating'

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
 * Nearest window source and endpoint both serve, keeping the bound just picked. Past the lookback
 * it would answer a shorter span than the picker shows; past the endpoint cap, nothing.
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
	if (dayRangeDays(range) <= cap) {
		return range
	}
	return edited === 'from'
		? { from: range.from, to: asDay(from + (cap - 1) * DAY_MS) }
		: { from: asDay(to - (cap - 1) * DAY_MS), to: range.to }
}

/**
 * Caption in the reporting timezone; raw days when a bound names no calendar day, so a hand-edited
 * URL captions what it asked for rather than `Invalid Date`.
 */
export const dayRangeCaption = (range: DayRange, locale: string, timezone: string): string => {
	const start = parseDayOrInstant(range.from, { timezone, edge: 'start' })
	const end = parseDayOrInstant(range.to, { timezone, edge: 'end' })
	if (!start || !end) {
		return `${range.from} - ${range.to}`
	}
	return formatRangeCaption({ start, end }, locale, timezone)
}
