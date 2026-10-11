import type { RateLimitDescriptor } from '../core/contract'
import { monotonicMs } from '../core/monotonic'
import { HOUR_MS, MINUTE_MS } from '../timeframe/tz'

/**
 * Who is asking, the first served first: a reader of an open panel or view, any other reader (a
 * sidebar stat, host code), or work nobody waits on (refreshes, jobs).
 */
export type Priority = 'interactive' | 'normal' | 'background'

const RANK: Readonly<Record<Priority, number>> = { interactive: 0, normal: 1, background: 2 }

/** The first of `waiting` with the most urgent priority. */
export const mostUrgent = <T extends { priority: Priority }>(
	waiting: readonly T[]
): T | undefined =>
	waiting.reduce<T | undefined>(
		(best, each) => (best === undefined || RANK[each.priority] < RANK[best.priority] ? each : best),
		undefined
	)

/**
 * The quota of one source: one token per upstream request, from every bucket its
 * `rateLimit` declares. Tokens are spent, never given back.
 */
export interface TokenSource {
	/**
	 * Resolves once a token is spent for one upstream request, the most urgent taker first, each
	 * priority in arrival order. Rejects with the signal's reason when it aborts first.
	 */
	take(options: { signal?: AbortSignal; priority: Priority }): Promise<void>
	/** Takers still waiting, for tests and health. */
	readonly waiting: number
}

interface TokenBucket {
	waitMs(now: number): number
	take(now: number): void
}

const createBucket = (capacity: number, windowMs: number): TokenBucket => {
	// ms per token, rather than tokens per ms: every descriptor in this codebase divides its window
	// evenly, so this stays exact where a capacity/windowMs rate would drift.
	const intervalMs = windowMs / capacity
	let tokens = capacity
	let last: number | undefined

	const sync = (now: number): void => {
		if (last === undefined) {
			last = now
			return
		}
		const elapsed = now - last
		if (elapsed > 0) {
			tokens = Math.min(capacity, tokens + elapsed / intervalMs)
			last = now
		}
	}

	return {
		waitMs(now) {
			sync(now)
			return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * intervalMs)
		},
		take(now) {
			sync(now)
			tokens -= 1
		},
	}
}

interface Taker {
	priority: Priority
	grant: () => void
}

const UNLIMITED: TokenSource = {
	take: async ({ signal }) => {
		if (signal?.aborted) {
			throw signal.reason
		}
	},
	waiting: 0,
}

/**
 * The token source a descriptor declares: one refilling bucket per named window, a take needing a
 * token from each. `maxConcurrent` is not a token; the lane turns it into its slot count.
 */
export const createTokenSource = (
	descriptor: RateLimitDescriptor | null,
	now: () => number = monotonicMs
): TokenSource => {
	const buckets: TokenBucket[] = []
	if (descriptor?.requestsPerMinute) {
		buckets.push(createBucket(descriptor.requestsPerMinute, MINUTE_MS))
	}
	if (descriptor?.requestsPerHour) {
		buckets.push(createBucket(descriptor.requestsPerHour, HOUR_MS))
	}
	if (buckets.length === 0) {
		return UNLIMITED
	}
	const takers: Taker[] = []
	let timer: ReturnType<typeof setTimeout> | undefined

	const next = (): Taker | undefined => mostUrgent(takers)

	// Bucket checks and deductions happen with no await between them, so two takers can never spend
	// one token; a taker that has to wait is granted by the single timer below, in priority order.
	const pump = (): void => {
		clearTimeout(timer)
		timer = undefined
		for (;;) {
			const taker = next()
			if (!taker) {
				return
			}
			const at = now()
			const waitMs = buckets.reduce((max, bucket) => Math.max(max, bucket.waitMs(at)), 0)
			if (waitMs > 0) {
				timer = setTimeout(pump, waitMs)
				timer.unref?.()
				return
			}
			for (const bucket of buckets) {
				bucket.take(at)
			}
			takers.splice(takers.indexOf(taker), 1)
			taker.grant()
		}
	}

	return {
		take({ signal, priority }) {
			if (signal?.aborted) {
				return Promise.reject(signal.reason)
			}
			return new Promise<void>((resolve, reject) => {
				const onAbort = (): void => {
					const index = takers.indexOf(taker)
					if (index !== -1) {
						takers.splice(index, 1)
						pump()
					}
					reject(signal?.reason)
				}
				const taker: Taker = {
					priority,
					grant: () => {
						signal?.removeEventListener('abort', onAbort)
						resolve()
					},
				}
				takers.push(taker)
				signal?.addEventListener('abort', onAbort, { once: true })
				pump()
			})
		},
		get waiting() {
			return takers.length
		},
	}
}
