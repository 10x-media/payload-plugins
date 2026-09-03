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
	filters: new Set(['page']),
	filterOperators: new Set(['eq']),
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

	// Only page has a backing MemoryEvent field; other declared dimensions drop as unsupported.
	const matchesFilters = (e: MemoryEvent, q: AnalyticsQuery): boolean =>
		(q.filters ?? []).every((filter) => {
			if (filter.dimension !== 'page' || filter.operator !== 'eq') {
				return true
			}
			return e.path === filter.value
		})

	const inRange = (e: MemoryEvent, q: AnalyticsQuery): boolean => {
		if (q.path && e.path !== q.path) return false
		if (!matchesFilters(e, q)) return false
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
			const countVisitors = (list: MemoryEvent[]): number =>
				new Set(list.map((e) => e.visitor ?? e.path + e.timestamp.toDateString())).size
			if (q.granularity === 'day') {
				const byDay = new Map<string, MemoryEvent[]>()
				for (const e of matched) {
					const day = new Date(
						Date.UTC(
							e.timestamp.getUTCFullYear(),
							e.timestamp.getUTCMonth(),
							e.timestamp.getUTCDate()
						)
					).toISOString()
					const list = byDay.get(day) ?? []
					list.push(e)
					byDay.set(day, list)
				}
				const rows = [...byDay.entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([day, list]) => ({
						timestamp: day,
						metrics: { pageviews: list.length, visitors: countVisitors(list) },
					}))
				return {
					rows,
					totals: { pageviews: matched.length, visitors: countVisitors(matched) },
					meta: { provider: 'memory', fetchedAt: q.dateRange.end.toISOString() },
				}
			}
			const pageviews = matched.length
			const visitors = countVisitors(matched)
			return {
				rows: [{ metrics: { pageviews, visitors } }],
				totals: { pageviews, visitors },
				meta: { provider: 'memory', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
}
