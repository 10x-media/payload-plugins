import { buildCacheKey } from '../core/cacheKey'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { DEFAULT_TIMEZONE, startOfDayInTz } from '../timeframe/tz'
import type { CacheStore } from './cacheStore'
import { createCoalescer } from './coalesce'
import { createQueue, type QueueOptions } from './queue'
import { limiterFor, type RateLimiter } from './rateLimiter'
import { PROVIDER_READ_TIMEOUT_MESSAGE, shouldRetryProviderError } from './retryPolicy'

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
	/** Budget for a single adapter read; the in-flight request is aborted past this. */
	timeoutMs: number
	/** Called once per failed adapter fetch, before falling back to a stale cache entry. */
	onError?: (err: unknown, adapterId: string) => void
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
	const limiters = new Map<string, RateLimiter>()
	const queue = createQueue({
		...opts.queue,
		shouldRetry: shouldRetryProviderError,
		baseDelayMs: 500,
	})

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
				let fresh: AnalyticsResult
				const controller = new AbortController()
				const timer = setTimeout(
					() => controller.abort(new Error(PROVIDER_READ_TIMEOUT_MESSAGE)),
					opts.timeoutMs
				)
				timer.unref?.()
				try {
					const cached = await opts.store.get<AnalyticsResult>(key)
					if (cached) return cached

					// Races the queued attempt itself, not just its backoff waits, so a signal-blind
					// adapter (one that never checks ctx.signal) still bounds the read at timeoutMs.
					// The orphaned attempt keeps its queue slot until the underlying client gives up;
					// this only bounds how long read() waits for it.
					const aborted = new Promise<never>((_resolve, reject) => {
						controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
							once: true,
						})
					})
					const attempt = queue.run(async () => {
						const release = await limiterFor(limiters, adapter).take(controller.signal)
						try {
							return await adapter.query(q, { signal: controller.signal })
						} finally {
							release()
						}
					}, controller.signal)
					attempt.catch(() => {})
					fresh = await Promise.race([attempt, aborted])
				} catch (err) {
					opts.onError?.(err, adapter.id)
					try {
						const stale = await opts.store.getStale<AnalyticsResult>(key)
						if (stale) return { ...stale, meta: { ...stale.meta, stale: true } }
					} catch {
						// A broken store fails getStale too; surface the original read error, not this one.
					}
					throw err
				} finally {
					clearTimeout(timer)
				}
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
