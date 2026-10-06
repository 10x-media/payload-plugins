/**
 * Share of the site's visitors a goal converted, as a 0..1 ratio rounded to four decimals.
 * Null when either side is missing, unreadable, or the site total is zero, where a rate is
 * undefined rather than zero. The two numbers come from separate reads (a goal breakdown
 * row and the range totals), so a bucket wider than the total is clamped instead of
 * reported as more than 100 percent.
 */
export const conversionRate = (
	goalVisitors: number | undefined,
	siteVisitors: number | undefined
): number | null => {
	if (goalVisitors === undefined || siteVisitors === undefined) {
		return null
	}
	if (!Number.isFinite(goalVisitors) || !Number.isFinite(siteVisitors) || siteVisitors === 0) {
		return null
	}
	const ratio = Math.min(Math.max(goalVisitors / siteVisitors, 0), 1)
	return Math.round(ratio * 10_000) / 10_000
}
