import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { createKvRateLimiter } from './rateLimiter'

const fakeKv = () => {
	const store = new Map<string, unknown>()
	return {
		get: async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
		set: async (key: string, value: unknown) => {
			store.set(key, value)
		},
		has: async (key: string) => store.has(key),
		delete: async (key: string) => {
			store.delete(key)
		},
		keys: async () => [...store.keys()],
		clear: async () => store.clear(),
	}
}

const reqWith = (kv: ReturnType<typeof fakeKv>): PayloadRequest =>
	({ payload: { kv } }) as unknown as PayloadRequest

describe('createKvRateLimiter', () => {
	it('allows up to max then blocks within the window', async () => {
		const now = 1000
		const limiter = createKvRateLimiter({ now: () => now })
		const req = reqWith(fakeKv())
		for (let i = 0; i < 3; i++) {
			expect((await limiter.check({ key: 'k', max: 3, window: 60_000, req })).ok).toBe(true)
		}
		const blocked = await limiter.check({ key: 'k', max: 3, window: 60_000, req })
		expect(blocked.ok).toBe(false)
		expect(blocked.remaining).toBe(0)
	})

	it('resets after the window elapses', async () => {
		let now = 1000
		const limiter = createKvRateLimiter({ now: () => now })
		const req = reqWith(fakeKv())
		await limiter.check({ key: 'k', max: 1, window: 1000, req })
		expect((await limiter.check({ key: 'k', max: 1, window: 1000, req })).ok).toBe(false)
		now += 1000
		expect((await limiter.check({ key: 'k', max: 1, window: 1000, req })).ok).toBe(true)
	})

	it('keys are independent', async () => {
		const limiter = createKvRateLimiter({ now: () => 0 })
		const req = reqWith(fakeKv())
		expect((await limiter.check({ key: 'a', max: 1, window: 1000, req })).ok).toBe(true)
		expect((await limiter.check({ key: 'b', max: 1, window: 1000, req })).ok).toBe(true)
	})

	it('reports remaining and resetAt', async () => {
		const limiter = createKvRateLimiter({ now: () => 5000 })
		const req = reqWith(fakeKv())
		const r = await limiter.check({ key: 'k', max: 5, window: 60_000, req })
		expect(r.remaining).toBe(4)
		expect(r.resetAt).toBe(65_000)
	})
})
