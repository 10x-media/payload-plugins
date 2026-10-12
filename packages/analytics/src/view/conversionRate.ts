import type { MetricValue } from '../core/contract'

/**
 * Share of site visitors a goal converted, 0..1 at four decimals; null when undefined (a side
 * missing, or zero total). Goal row and totals are separate reads, so it clamps at 1.
 */
export const conversionRate = (
	goalVisitors: MetricValue | undefined,
	siteVisitors: MetricValue | undefined
): number | null => {
	if (typeof goalVisitors !== 'number' || typeof siteVisitors !== 'number') {
		return null
	}
	if (!Number.isFinite(goalVisitors) || !Number.isFinite(siteVisitors) || siteVisitors === 0) {
		return null
	}
	const ratio = Math.min(Math.max(goalVisitors / siteVisitors, 0), 1)
	return Math.round(ratio * 10_000) / 10_000
}

/**
 * One item's clicks over its own views, `null` with none. Clicks can outrun counted views (a click
 * in the first second, a browser that cannot measure visibility), so it clamps at 100 percent.
 */
export const clickRate = (
	clicks: MetricValue | undefined,
	views: MetricValue | undefined
): number | null => conversionRate(clicks, views)
