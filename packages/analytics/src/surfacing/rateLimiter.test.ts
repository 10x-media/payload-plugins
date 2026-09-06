import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { createRateLimiter, limiterFor } from './rateLimiter'

describe('createRateLimiter', () => {
	it('passes through immediately for a null descriptor', async () => {
		const limiter = createRateLimiter(null)
		const releases = await Promise.all([limiter.take(), limiter.take(), limiter.take()])
		expect(releases).toHaveLength(3)
		expect(() => {
			for (const release of releases) release()
		}).not.toThrow()
	})

	it('allows N takes immediately at capacity, then makes the N+1th wait for refill', async () => {
		vi.useFakeTimers()
		try {
			const limiter = createRateLimiter({ requestsPerMinute: 2 })
			// Fake timers never auto-advance, so these would hang past the test timeout
			// if either take needed to wait on a bucket refill.
			await limiter.take()
			await limiter.take()

			let resolved = false
			limiter.take().then(() => {
				resolved = true
			})
			await vi.advanceTimersByTimeAsync(0)
			expect(resolved).toBe(false)

			await vi.advanceTimersByTimeAsync(29_999)
			expect(resolved).toBe(false)

			await vi.advanceTimersByTimeAsync(1)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('enforces an hourly bucket on the same refill schedule', async () => {
		vi.useFakeTimers()
		try {
			const limiter = createRateLimiter({ requestsPerHour: 2 })
			await limiter.take()
			await limiter.take()

			let resolved = false
			limiter.take().then(() => {
				resolved = true
			})
			await vi.advanceTimersByTimeAsync(1_799_999)
			expect(resolved).toBe(false)

			await vi.advanceTimersByTimeAsync(1)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('requires a token from every configured bucket, gating on the tighter one', async () => {
		vi.useFakeTimers()
		try {
			// Minute bucket refills a token every 12s; hour bucket every 30min. The hour
			// bucket is exhausted first and must be the one that gates the third take.
			const limiter = createRateLimiter({ requestsPerMinute: 5, requestsPerHour: 2 })
			await limiter.take()
			await limiter.take()

			let resolved = false
			limiter.take().then(() => {
				resolved = true
			})

			await vi.advanceTimersByTimeAsync(12_000)
			expect(resolved).toBe(false) // minute bucket alone would have refilled by now

			await vi.advanceTimersByTimeAsync(1_800_000 - 12_000)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('does not refund a spent token on release', async () => {
		vi.useFakeTimers()
		try {
			const limiter = createRateLimiter({ requestsPerMinute: 1 })
			const release = await limiter.take()
			release()

			let resolved = false
			limiter.take().then(() => {
				resolved = true
			})
			await vi.advanceTimersByTimeAsync(59_999)
			expect(resolved).toBe(false)
			await vi.advanceTimersByTimeAsync(1)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('blocks a second take under maxConcurrent until the first releases', async () => {
		const limiter = createRateLimiter({ maxConcurrent: 1 })
		const release = await limiter.take()

		let resolved = false
		limiter.take().then(() => {
			resolved = true
		})
		await Promise.resolve() // flush a microtask tick
		expect(resolved).toBe(false)

		release()
		await vi.waitFor(() => expect(resolved).toBe(true))
	})

	it('rejects a take waiting on a token bucket when aborted, without leaking a token', async () => {
		vi.useFakeTimers()
		try {
			const limiter = createRateLimiter({ requestsPerMinute: 1 })
			await limiter.take()

			const controller = new AbortController()
			const reason = new Error('aborted')
			const pending = limiter.take(controller.signal)
			const assertion = expect(pending).rejects.toBe(reason)
			controller.abort(reason)
			await assertion

			// The abandoned wait must not have consumed the token that was about to refill:
			// a fresh take still resolves on the bucket's normal schedule, not early.
			let resolved = false
			limiter.take().then(() => {
				resolved = true
			})
			await vi.advanceTimersByTimeAsync(59_999)
			expect(resolved).toBe(false)
			await vi.advanceTimersByTimeAsync(1)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects a take waiting on maxConcurrent when aborted, without leaking a slot', async () => {
		const limiter = createRateLimiter({ maxConcurrent: 1 })
		const release = await limiter.take()

		const controller = new AbortController()
		const reason = new Error('aborted')
		const pending = limiter.take(controller.signal)
		const assertion = expect(pending).rejects.toBe(reason)
		controller.abort(reason)
		await assertion

		release()
		const next = await limiter.take()
		expect(typeof next).toBe('function')
	})

	it('rejects immediately when the signal is already aborted', async () => {
		const limiter = createRateLimiter({ requestsPerMinute: 1 })
		const controller = new AbortController()
		const reason = new Error('already aborted')
		controller.abort(reason)
		await expect(limiter.take(controller.signal)).rejects.toBe(reason)
	})
})

describe('limiterFor', () => {
	it('builds a limiter once per adapter id and reuses it', () => {
		const map = new Map()
		const adapter: AnalyticsAdapter = {
			...memoryAdapter(),
			id: 'plausible',
			capabilities: { ...memoryAdapter().capabilities, rateLimit: { requestsPerHour: 600 } },
		}
		const a = limiterFor(map, adapter)
		const b = limiterFor(map, adapter)
		expect(a).toBe(b)
		expect(map.size).toBe(1)
	})
})
