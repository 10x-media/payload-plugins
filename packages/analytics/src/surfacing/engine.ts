import { buildCacheKey } from '../core/cacheKey'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import type { CacheStore } from './cacheStore'
import { createCoalescer } from './coalesce'
import { createQueue, type QueueOptions } from './queue'

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

			const key = buildCacheKey(adapter.id, query)
			return coalesce(key, async () => {
				const cached = await opts.store.get<AnalyticsResult>(key)
				if (cached) return cached

				const fresh = await queue.run(() => adapter.query(query, {}))
				const ttl = adapter.capabilities.recommendedTtl.aggregate || opts.ttl.aggregate
				await opts.store.set(key, fresh, ttl)
				return fresh
			})
		},
	}
}
