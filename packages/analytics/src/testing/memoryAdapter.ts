import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	DimensionKey,
	MetricKey,
} from '../core/contract'

interface MemoryEvent {
	path: string
	timestamp: Date
	visitor?: string
}

const metrics: ReadonlySet<MetricKey> = new Set([
	'pageviews',
	'visitors',
	'visits',
	'sessions',
	'bounceRate',
	'avgDuration',
])
const dimensions: ReadonlySet<DimensionKey> = new Set(['page', 'referrer', 'country', 'device'])

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: true,
	realtimeWindowMinutes: 5,
	comparison: true,
	minGranularity: 'minute',
	maxLookbackDays: null,
	metrics,
	dimensions,
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

export interface MemoryAnalyticsAdapter extends AnalyticsAdapter {
	record(event: MemoryEvent): void
	reset(): void
}

export function memoryAdapter(): MemoryAnalyticsAdapter {
	const events: MemoryEvent[] = []

	const inRange = (e: MemoryEvent, q: AnalyticsQuery): boolean => {
		if (q.path && e.path !== q.path) return false
		return e.timestamp >= q.dateRange.start && e.timestamp <= q.dateRange.end
	}

	return {
		id: 'memory',
		label: 'In-memory (testing)',
		capabilities,
		isConfigured: () => true,
		record: (event) => {
			events.push(event)
		},
		reset: () => {
			events.length = 0
		},
		async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			const matched = events.filter((e) => inRange(e, q))
			const pageviews = matched.length
			const visitors = new Set(matched.map((e) => e.visitor ?? e.path + e.timestamp.toDateString()))
				.size
			return {
				rows: [{ metrics: { pageviews, visitors } }],
				totals: { pageviews, visitors },
				meta: { provider: 'memory', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
}
