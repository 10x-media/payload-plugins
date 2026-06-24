import type { AnalyticsRow, DateRange, MetricKey } from '../../core/contract'

export interface RealtimeEvent {
	timestamp: string
	type: string
	visitorHash: string
}

const MINUTE_MS = 60_000

const startOfMinute = (ms: number): number => ms - (ms % MINUTE_MS)

const selectRealtime = (
	pageviews: number,
	visitors: number,
	metrics: MetricKey[]
): Partial<Record<MetricKey, number>> => {
	const out: Partial<Record<MetricKey, number>> = {}
	if (metrics.includes('pageviews')) out.pageviews = pageviews
	if (metrics.includes('visitors')) out.visitors = visitors
	return out
}

/**
 * Collapse recent events into a zero-filled per-minute series plus window totals.
 * "Active visitors" is the distinct `visitorHash` count (over any event); pageviews
 * count `type === 'pageview'`. Distinct visitors are counted per minute and over the
 * whole window separately (never summed across minutes).
 */
export const buildRealtime = (
	events: RealtimeEvent[],
	range: DateRange,
	metrics: MetricKey[]
): { rows: AnalyticsRow[]; totals: Partial<Record<MetricKey, number>> } => {
	const buckets = new Map<number, { pv: number; visitors: Set<string> }>()
	const allVisitors = new Set<string>()
	let pageviews = 0
	for (const e of events) {
		if (e.type === 'pageview') pageviews++
		allVisitors.add(e.visitorHash)
		const minute = startOfMinute(new Date(e.timestamp).getTime())
		let b = buckets.get(minute)
		if (!b) {
			b = { pv: 0, visitors: new Set() }
			buckets.set(minute, b)
		}
		if (e.type === 'pageview') b.pv++
		b.visitors.add(e.visitorHash)
	}
	const rows: AnalyticsRow[] = []
	const first = startOfMinute(range.start.getTime())
	const last = startOfMinute(range.end.getTime())
	for (let m = first; m <= last; m += MINUTE_MS) {
		const b = buckets.get(m)
		rows.push({
			timestamp: new Date(m).toISOString(),
			metrics: selectRealtime(b?.pv ?? 0, b?.visitors.size ?? 0, metrics),
		})
	}
	return { rows, totals: selectRealtime(pageviews, allVisitors.size, metrics) }
}
