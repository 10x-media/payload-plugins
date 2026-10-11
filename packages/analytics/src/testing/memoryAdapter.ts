import { ProviderHttpError } from '../adapters/http/fetchJson'
import { readTime } from '../adapters/readTime'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	DimensionKey,
	MetricKey,
} from '../core/contract'

export interface MemoryEvent {
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
	realtime: true,
	realtimeWindowMinutes: 5,
	minGranularity: 'minute',
	maxLookbackDays: null,
	metrics,
	dimensions,
	// Only `page` has a backing field on a recorded event, compared exactly.
	filters: { page: ['eq'] },
	rateLimit: null,
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

export interface MemoryAnalyticsAdapter extends AnalyticsAdapter {
	record(event: MemoryEvent): void
	reset(): void
	/**
	 * Test seam for engine resilience: the next `times` query() calls (default 1) reject with err.
	 * The engine retries an outage twice, so failing a whole read that way takes three.
	 */
	failNext(err?: Error, times?: number): void
}

export function memoryAdapter(): MemoryAnalyticsAdapter {
	const events: MemoryEvent[] = []
	let pendingFailure: Error | undefined
	let failuresLeft = 0

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
		failNext: (err, times = 1) => {
			pendingFailure = err ?? new ProviderHttpError(500, 'memory', 'memory: injected failure')
			failuresLeft = times
		},
		async query(q: AnalyticsQuery, ctx: AdapterContext): Promise<AnalyticsResult> {
			const fetchedAt = readTime(ctx)
			if (pendingFailure && failuresLeft > 0) {
				const err = pendingFailure
				failuresLeft--
				if (failuresLeft === 0) {
					pendingFailure = undefined
				}
				throw err
			}
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
					meta: { provider: 'memory', fetchedAt },
				}
			}
			const pageviews = matched.length
			const visitors = countVisitors(matched)
			return {
				rows: [{ metrics: { pageviews, visitors } }],
				totals: { pageviews, visitors },
				meta: { provider: 'memory', fetchedAt },
			}
		},
	}
}
