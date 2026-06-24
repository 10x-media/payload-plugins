import { buildCacheKey } from '../core/cacheKey'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import type { CacheStore } from './cacheStore'
import { createCoalescer } from './coalesce'
import { createQueue, type QueueOptions } from './queue'

const DAY_MS = 86_400_000
const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const clampRange = (
	range: AnalyticsQuery['dateRange'],
	maxLookbackDays: number | null
): { range: AnalyticsQuery['dateRange']; clamped: boolean } => {
	if (maxLookbackDays == null) {
		return { range, clamped: false }
	}
	const floor = new Date(startOfUtcDay(range.end).getTime() - maxLookbackDays * DAY_MS)
	if (range.start.getTime() >= floor.getTime()) {
		return { range, clamped: false }
	}
	return { range: { start: floor, end: range.end }, clamped: true }
}

export interface EngineOptions {
	store: CacheStore
	queue: QueueOptions
	ttl: { aggregate: number; realtime: number }
}

export interface Engine {
	read(adapter: AnalyticsAdapter, query: AnalyticsQuery): Promise<AnalyticsResult>
}

const emptyResult = (provider: string, q: AnalyticsQuery): AnalyticsResult => ({
	rows: [],
	meta: { provider, fetchedAt: q.dateRange.end.toISOString() },
})

export function createEngine(opts: EngineOptions): Engine {
	const coalesce = createCoalescer<AnalyticsResult>()
	const queue = createQueue(opts.queue)

	return {
		async read(adapter, query) {
			if (!adapter.isConfigured()) return emptyResult(adapter.id, query)

			const { range, clamped } = clampRange(query.dateRange, adapter.capabilities.maxLookbackDays)
			const q = clamped ? { ...query, dateRange: range } : query
			const key = buildCacheKey(adapter.id, q)
			return coalesce(key, async () => {
				const cached = await opts.store.get<AnalyticsResult>(key)
				if (cached) return cached

				const fresh = await queue.run(() => adapter.query(q, {}))
				const result: AnalyticsResult = clamped
					? { ...fresh, meta: { ...fresh.meta, clamped: true } }
					: fresh
				const ttl = adapter.capabilities.recommendedTtl.aggregate || opts.ttl.aggregate
				await opts.store.set(key, result, ttl)
				return result
			})
		},
	}
}
