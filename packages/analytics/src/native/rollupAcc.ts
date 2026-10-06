import type { AnalyticsRow, MetricKey } from '../core/contract'
import { DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'

export interface RollupDoc {
	path: string
	dimvalue: string
	period: string | Date
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
	/** Optional: rows written before the goal-counter migration carry none of these. */
	conversions?: number
	revenue?: number
	scrollDepthSum?: number
	scrollSamples?: number
}

export interface Acc {
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
	conversions: number
	revenue: number
	scrollDepthSum: number
	/** Pageviews that reported a scroll depth; the `scrollDepth` average's denominator. */
	scrollSamples: number
}

export const emptyAcc = (): Acc => ({
	pageviews: 0,
	events: 0,
	durationMs: 0,
	visitors: 0,
	sessions: 0,
	conversions: 0,
	revenue: 0,
	scrollDepthSum: 0,
	scrollSamples: 0,
})

export const add = (acc: Acc, d: RollupDoc | Acc): void => {
	acc.pageviews += d.pageviews
	acc.events += d.events
	acc.durationMs += d.durationMs
	acc.visitors += d.visitors
	acc.sessions += d.sessions
	acc.conversions += d.conversions ?? 0
	acc.revenue += d.revenue ?? 0
	acc.scrollDepthSum += d.scrollDepthSum ?? 0
	acc.scrollSamples += d.scrollSamples ?? 0
}

export const selectMetrics = (
	acc: Acc,
	wanted: MetricKey[]
): Partial<Record<MetricKey, number>> => {
	const out: Partial<Record<MetricKey, number>> = {}
	if (wanted.includes('pageviews')) out.pageviews = acc.pageviews
	if (wanted.includes('events')) out.events = acc.events
	if (wanted.includes('visitors')) out.visitors = acc.visitors
	if (wanted.includes('sessions')) out.sessions = acc.sessions
	if (wanted.includes('conversions')) out.conversions = acc.conversions
	if (wanted.includes('revenue')) out.revenue = acc.revenue
	if (wanted.includes('avgDuration')) {
		out.avgDuration = acc.pageviews > 0 ? Math.round(acc.durationMs / acc.pageviews) : 0
	}
	if (wanted.includes('scrollDepth')) {
		// Averaged over the pageviews that reported a depth, never over every pageview: a
		// tracker that never got to send one must not drag the average down.
		out.scrollDepth = acc.scrollSamples > 0 ? Math.round(acc.scrollDepthSum / acc.scrollSamples) : 0
	}
	return out
}

/**
 * Collapse per-day rollup docs into one time-series row per day in `tz` (UTC by
 * default), ascending by day. Rollups are already bucketed to their reporting-timezone
 * day at ingest, so flooring in the same `tz` is idempotent; passing the read's timezone
 * keeps a trend aligned to that zone. Distinct metrics (visitors/sessions) come from each
 * day's own rollup and are never summed across days, so a daily trend shows that day's
 * uniques.
 */
export const seriesFromRollups = (
	docs: RollupDoc[],
	metrics: MetricKey[],
	tz: string = DEFAULT_TIMEZONE
): AnalyticsRow[] => {
	const byDay = new Map<string, Acc>()
	for (const d of docs) {
		const day = startOfDayInTz(new Date(d.period), tz).toISOString()
		let acc = byDay.get(day)
		if (!acc) {
			acc = emptyAcc()
			byDay.set(day, acc)
		}
		add(acc, d)
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([day, acc]) => ({ timestamp: day, metrics: selectMetrics(acc, metrics) }))
}
