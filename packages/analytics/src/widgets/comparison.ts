import type { DateRange } from '../core/contract'
import { addDaysInTz, DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'

export type DeltaDirection = 'up' | 'down' | 'none'

export interface MetricDelta {
	direction: DeltaDirection
	/**
	 * Signed percentage change vs the previous value, or null when the previous value is
	 * 0 (the baseline is undefined, so a percentage would be infinite/meaningless).
	 */
	percent: number | null
}

const DAY_MS = 86_400_000

/**
 * Comparison windows beyond a year are not meaningful period-over-period reads; the cap
 * also rejects the unbounded `allTime` range, which would otherwise compare against a
 * pre-1970 window.
 */
const MAX_COMPARISON_DAYS = 366

/**
 * The comparable window immediately preceding `range`, aligned to whole reporting-timezone
 * days so daily rollup stores (which stamp each day at its local midnight) never lose their
 * first day to a mid-day window start. It spans the same count of calendar days the current
 * range touches (the current partial day counts as one) and ends 1ms before the current
 * range's first day. Returns null when the range spans more than
 * {@link MAX_COMPARISON_DAYS} days, where a previous period is not meaningful.
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
 * Period-over-period delta for one metric value against its previous-window value.
 * Returns null when either side is missing so the caller can omit the comparison.
 */
export const computeDelta = (current?: number, previous?: number): MetricDelta | null => {
	if (current === undefined || previous === undefined) {
		return null
	}
	const diff = current - previous
	const direction: DeltaDirection = diff > 0 ? 'up' : diff < 0 ? 'down' : 'none'
	const percent = previous === 0 ? null : (diff / previous) * 100
	return { direction, percent }
}
