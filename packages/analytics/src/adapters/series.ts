/**
 * Normalize a provider's day label to a UTC-day ISO string. Takes any value whose first
 * 10 chars are `YYYY-MM-DD` (a bare date, or a datetime like `2026-06-23 14:00:00`).
 * Returns null for an unparseable value so the caller can skip that one row rather than
 * emit a broken timestamp.
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
