import type { DateRange, MetricValue } from '../core/contract'
import { addDaysInTz, DAY_MS, DEFAULT_TIMEZONE, startOfDayInTz } from './tz'

export type DeltaDirection = 'up' | 'down' | 'none'

interface MetricDelta {
	direction: DeltaDirection
	/** Signed percent change vs the previous value; null when that is 0, which is no baseline. */
	percent: number | null
}

/**
 * Period-over-period beyond a year is not meaningful; the cap also rejects the unbounded `allTime`
 * range, which would compare against a pre-1970 window.
 */
const MAX_COMPARISON_DAYS = 366

/**
 * As many whole days in `tz` as `range` touches, ending 1 ms before its first day, so a source
 * keeping daily totals never loses a day to a mid-day start. Null past {@link MAX_COMPARISON_DAYS}.
 */
export const previousWindow = (
	range: DateRange,
	tz: string = DEFAULT_TIMEZONE
): DateRange | null => {
	const firstDay = startOfDayInTz(range.start, tz)
	const lastDay = startOfDayInTz(range.end, tz)
	const days = Math.round((lastDay.getTime() - firstDay.getTime()) / DAY_MS) + 1
	if (!Number.isFinite(days) || days < 1 || days > MAX_COMPARISON_DAYS) {
		return null
	}
	return { start: addDaysInTz(firstDay, -days, tz), end: new Date(firstDay.getTime() - 1) }
}

/**
 * Whether a source still answers for `window`; callers omit the comparison otherwise. The floor
 * anchors on `now`, as providers count lookback from today, and may be an hour off across DST.
 */
export const withinLookback = (
	window: DateRange,
	maxLookbackDays: number | null,
	args: { tz?: string; now: Date }
): boolean => {
	if (maxLookbackDays == null) {
		return true
	}
	const floor =
		startOfDayInTz(args.now, args.tz ?? DEFAULT_TIMEZONE).getTime() - maxLookbackDays * DAY_MS
	return window.start.getTime() >= floor
}

/**
 * Period-over-period delta for one metric value against its previous-window value. Null when
 * either side is missing or `null`: an average with no samples is no baseline and no change.
 */
export const computeDelta = (current?: MetricValue, previous?: MetricValue): MetricDelta | null => {
	if (typeof current !== 'number' || typeof previous !== 'number') {
		return null
	}
	const diff = current - previous
	const direction: DeltaDirection = diff > 0 ? 'up' : diff < 0 ? 'down' : 'none'
	const percent = previous === 0 ? null : (diff / previous) * 100
	return { direction, percent }
}
