import { buildCacheKey } from '../core/cacheKey'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { CacheStore } from './cacheStore'
import { createCoalescer } from './coalesce'
import { createQueue, type QueueOptions } from './queue'

const DAY_MS = 86_400_000

const clampRange = (
	range: AnalyticsQuery['dateRange'],
	maxLookbackDays: number | null,
	tz: string = DEFAULT_TIMEZONE
): { range: AnalyticsQuery['dateRange']; clamped: boolean } => {
	if (maxLookbackDays == null) {
		return { range, clamped: false }
	}
	const floor = new Date(startOfDayInTz(range.end, tz).getTime() - maxLookbackDays * DAY_MS)
	if (range.start.getTime() >= floor.getTime()) {
		return { range, clamped: false }
	}
	return { range: { start: floor, end: range.end }, clamped: true }
}

export interface EngineOptions {
	store: CacheStore
	queue: QueueOptions
	/** Explicit TTL overrides; when a value is unset the adapter's recommendedTtl applies. */
	ttl: { aggregate?: number; realtime?: number }
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

			const { range, clamped } = clampRange(
				query.dateRange,
				adapter.capabilities.maxLookbackDays,
				query.timezone
			)
			const q = clamped ? { ...query, dateRange: range } : query
			const key = buildCacheKey(adapter.id, q)
			return coalesce(key, async () => {
				const cached = await opts.store.get<AnalyticsResult>(key)
				if (cached) return cached

				const fresh = await queue.run(() => adapter.query(q, {}))
				const result: AnalyticsResult = clamped
					? { ...fresh, meta: { ...fresh.meta, clamped: true } }
					: fresh
				const ttl = opts.ttl.aggregate ?? adapter.capabilities.recommendedTtl.aggregate
				await opts.store.set(key, result, ttl)
				return result
			})
		},
	}
}
