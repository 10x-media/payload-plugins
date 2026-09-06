import type { AnalyticsAdapter, RateLimitDescriptor } from '../core/contract'

export interface RateLimiter {
	/** Resolves when a request slot is available; rejects with the signal's reason when aborted while waiting. Release must be called exactly once per successful take. */
	take(signal?: AbortSignal): Promise<() => void>
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

interface TokenBucket {
	waitMs(now: number): number
	take(now: number): void
}

const createBucket = (capacity: number, windowMs: number): TokenBucket => {
	// ms per token, rather than tokens-per-ms: for every descriptor value in this codebase
	// windowMs divides evenly by capacity, so this stays exact and sidesteps the float
	// drift a capacity/windowMs rate would reintroduce on the multiply-then-divide round trip.
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
			if (tokens >= 1) return 0
			return Math.ceil((1 - tokens) * intervalMs)
		},
		take(now) {
			sync(now)
			tokens -= 1
		},
	}
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
	if (signal?.aborted) return Promise.reject(signal.reason)
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		const onAbort = (): void => {
			clearTimeout(timer)
			reject(signal?.reason)
		}
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

/**
 * Waits until every bucket holds a token, then deducts one from each. Bucket checks and
 * deductions happen synchronously (no await between them) so a zero-wait pass can never
 * race; a non-zero wait rechecks after sleeping since a concurrent taker may have spent
 * the token first.
 */
const acquireTokens = async (
	buckets: TokenBucket[],
	clock: () => number,
	signal?: AbortSignal
): Promise<void> => {
	for (;;) {
		if (signal?.aborted) throw signal.reason
		const now = clock()
		const maxWait = buckets.reduce((max, bucket) => Math.max(max, bucket.waitMs(now)), 0)
		if (maxWait === 0) {
			for (const bucket of buckets) bucket.take(now)
			return
		}
		await sleep(maxWait, signal)
	}
}

interface Semaphore {
	acquire(signal?: AbortSignal): Promise<() => void>
}

const createSemaphore = (capacity: number): Semaphore => {
	let active = 0
	const waiters: Array<() => void> = []

	const release = (): void => {
		active--
		waiters.shift()?.()
	}

	return {
		acquire(signal) {
			if (signal?.aborted) return Promise.reject(signal.reason)
			if (active < capacity) {
				active++
				return Promise.resolve(release)
			}
			return new Promise<() => void>((resolve, reject) => {
				const onAbort = (): void => {
					const idx = waiters.indexOf(grant)
					if (idx !== -1) waiters.splice(idx, 1)
					reject(signal?.reason)
				}
				const grant = (): void => {
					signal?.removeEventListener('abort', onAbort)
					active++
					resolve(release)
				}
				waiters.push(grant)
				signal?.addEventListener('abort', onAbort, { once: true })
			})
		},
	}
}

const noopRelease = (): void => {}

/**
 * Builds a limiter from an adapter's declared RateLimitDescriptor; a null descriptor
 * returns an unlimited pass-through. requestsPerMinute and requestsPerHour each maintain
 * their own continuously refilling token bucket and a take needs a token from every
 * configured bucket; maxConcurrent is a plain semaphore released by the returned function.
 * Token deductions are never released; they represent quota already spent.
 */
export const createRateLimiter = (
	descriptor: RateLimitDescriptor | null,
	clock: () => number = Date.now
): RateLimiter => {
	if (!descriptor) {
		return { take: async () => noopRelease }
	}

	const buckets: TokenBucket[] = []
	if (descriptor.requestsPerMinute)
		buckets.push(createBucket(descriptor.requestsPerMinute, MINUTE_MS))
	if (descriptor.requestsPerHour) buckets.push(createBucket(descriptor.requestsPerHour, HOUR_MS))
	const semaphore = descriptor.maxConcurrent ? createSemaphore(descriptor.maxConcurrent) : undefined

	return {
		async take(signal) {
			if (signal?.aborted) throw signal.reason
			const releaseConcurrency = semaphore ? await semaphore.acquire(signal) : noopRelease
			try {
				if (buckets.length) await acquireTokens(buckets, clock, signal)
				return releaseConcurrency
			} catch (err) {
				releaseConcurrency()
				throw err
			}
		},
	}
}

/** Returns the adapter's limiter, building and caching it from its declared rateLimit on first use. */
export const limiterFor = (
	map: Map<string, RateLimiter>,
	adapter: AnalyticsAdapter,
	clock?: () => number
): RateLimiter => {
	let limiter = map.get(adapter.id)
	if (!limiter) {
		limiter = createRateLimiter(adapter.capabilities.rateLimit, clock)
		map.set(adapter.id, limiter)
	}
	return limiter
}
