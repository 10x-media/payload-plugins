import type { AnalyticsRow } from '../core/contract'
import type { GoalKeyedRow } from './goalRead'

/**
 * A provider's day label (anything starting `YYYY-MM-DD`) as a UTC-day ISO string, or null so the
 * caller skips that row rather than emit a broken timestamp.
 */
export const dayIso = (value: string): string | null => {
	const date = value.slice(0, 10)
	// V8's Date.parse leniently accepts year-only and year-month strings, so require a
	// full YYYY-MM-DD before parsing or a short value would resolve to Jan 1, not null.
	if (date.length !== 10) {
		return null
	}
	const t = Date.parse(`${date}T00:00:00.000Z`)
	return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * A provider's hour label (`2026-06-23 14:00:00`, space- or T-separated) as a UTC ISO string, or null
 * for an unparseable or truncated one.
 */
export const hourIso = (value: string): string | null => {
	if (value.length < 19) {
		return null
	}
	const t = Date.parse(`${value.slice(0, 10)}T${value.slice(11, 19)}.000Z`)
	return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Keyed rows as series points dated by their first key; a row `isoOf` cannot date is skipped. */
export const datedRows = (
	rows: readonly GoalKeyedRow[],
	isoOf: (key: string) => string | null
): AnalyticsRow[] =>
	rows.flatMap((row) => {
		const timestamp = isoOf(row.keys[0] ?? '')
		return timestamp === null
			? []
			: [{ timestamp, metrics: row.metrics, ...(row.samples ? { samples: row.samples } : {}) }]
	})
