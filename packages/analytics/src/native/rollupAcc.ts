import type { AnalyticsRow, MetricKey } from '../core/contract'

export interface RollupDoc {
	path: string
	dimvalue: string
	period: string | Date
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
}

export interface Acc {
	pageviews: number
	events: number
	durationMs: number
	visitors: number
	sessions: number
}

export const emptyAcc = (): Acc => ({
	pageviews: 0,
	events: 0,
	durationMs: 0,
	visitors: 0,
	sessions: 0,
})

export const add = (acc: Acc, d: Acc): void => {
	acc.pageviews += d.pageviews
	acc.events += d.events
	acc.durationMs += d.durationMs
	acc.visitors += d.visitors
	acc.sessions += d.sessions
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
	if (wanted.includes('avgDuration')) {
		out.avgDuration = acc.pageviews > 0 ? Math.round(acc.durationMs / acc.pageviews) : 0
	}
	return out
}

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/**
 * Collapse per-day rollup docs into one time-series row per UTC day, ascending by
 * day. Distinct metrics (visitors/sessions) come from each day's own rollup and are
 * never summed across days, so a daily trend shows that day's uniques.
 */
export const seriesFromRollups = (docs: RollupDoc[], metrics: MetricKey[]): AnalyticsRow[] => {
	const byDay = new Map<string, Acc>()
	for (const d of docs) {
		const day = startOfUtcDay(new Date(d.period)).toISOString()
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
