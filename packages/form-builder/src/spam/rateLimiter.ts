import type { RateLimiter } from './types'

type WindowState = { count: number; windowStart: number }

/**
 * The default rate limiter: a read-modify-write window counter over Payload's `payload.kv`
 * (always present; default `DatabaseKVAdapter`, durable + cross-instance). Because the KV interface
 * has no atomic increment, the get-then-set is NON-ATOMIC, so a concurrent burst can slightly undercount.
 * This is a SOFT limit, acceptable for spam basics and complemented by edge/WAF limiting. The window
 * expires lazily on read; stale keys for one-time identities linger (minor; the count self-resets).
 * `now` is injectable for tests.
 */
export const createKvRateLimiter = (
	options: { now?: () => number; namespace?: string } = {}
): RateLimiter => {
	const now = options.now ?? (() => Date.now())
	const prefix = options.namespace ?? 'fb:rl:'
	return {
		async check({ key, max, window, req }) {
			const kv = req.payload.kv
			const storeKey = `${prefix}${key}`
			const current = now()
			const existing = await kv.get<WindowState>(storeKey).catch(() => null)
			let count: number
			let windowStart: number
			if (!existing || current - existing.windowStart >= window) {
				count = 1
				windowStart = current
			} else {
				count = existing.count + 1
				windowStart = existing.windowStart
			}
			await kv.set(storeKey, { count, windowStart }).catch(() => undefined)
			return {
				ok: count <= max,
				remaining: Math.max(0, max - count),
				resetAt: windowStart + window,
			}
		},
	}
}
