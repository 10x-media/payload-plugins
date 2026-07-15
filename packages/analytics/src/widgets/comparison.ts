import type { DateRange } from '../core/contract'

export type DeltaDirection = 'up' | 'down' | 'none'

export interface MetricDelta {
	direction: DeltaDirection
	/**
	 * Signed percentage change vs the previous value, or null when the previous value is
	 * 0 (the baseline is undefined, so a percentage would be infinite/meaningless).
	 */
	percent: number | null
}

/**
 * The comparable window immediately preceding `range`, of equal length. A 7-day current
 * window compares against the 7 days before it. Bucketing/timezone alignment is inherited
 * from `range` since it is derived from the same start/end instants.
 */
export const previousWindow = (range: DateRange): DateRange => {
	const durationMs = range.end.getTime() - range.start.getTime()
	return { start: new Date(range.start.getTime() - durationMs), end: new Date(range.start) }
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
