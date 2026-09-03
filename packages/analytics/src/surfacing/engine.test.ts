import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { kvCacheStore } from './cacheStore'
import { createEngine } from './engine'

const q: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

const setup = () => {
	const adapter = memoryAdapter()
	adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
	const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
	const engine = createEngine({
		store,
		queue: { concurrency: 4 },
		ttl: { aggregate: 60, realtime: 5 },
		timeoutMs: 15_000,
	})
	return { adapter, engine, store }
}

describe('createEngine', () => {
	it('returns adapter data on cold miss and caches it', async () => {
		const { adapter, engine } = setup()
		const spy = vi.spyOn(adapter, 'query')
		const a = await engine.read(adapter, q)
		const b = await engine.read(adapter, q)
		expect(a.totals?.pageviews).toBe(1)
		expect(b.totals?.pageviews).toBe(1)
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('returns an unconfigured empty result without calling the adapter', async () => {
		const { engine } = setup()
		const unconfigured = { ...memoryAdapter(), isConfigured: () => false }
		const spy = vi.spyOn(unconfigured, 'query')
		const result = await engine.read(unconfigured, q)
		expect(result.rows).toEqual([])
		expect(result.meta.provider).toBe('memory')
		expect(spy).not.toHaveBeenCalled()
	})

	it('clamps the query range to the adapter maxLookbackDays and flags it', async () => {
		let received: { start: Date; end: Date } | undefined
		const adapter: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: { ...memoryAdapter().capabilities, maxLookbackDays: 30 },
			isConfigured: () => true,
			query: async (query) => {
				received = query.dateRange
				return { rows: [], totals: { pageviews: 1 }, meta: { provider: 'limited', fetchedAt: '' } }
			},
		}
		const { engine } = setup()
		const end = new Date('2026-06-30T00:00:00.000Z')
		const res = await engine.read(adapter, {
			metrics: ['pageviews'],
			dateRange: { start: new Date('2025-06-30T00:00:00.000Z'), end },
		})
		expect(received?.start.toISOString()).toBe('2026-05-31T00:00:00.000Z')
		expect(res.meta.clamped).toBe(true)
	})

	it('serves a stale cache entry and calls onError once when the adapter fails', async () => {
		vi.useFakeTimers()
		try {
			const adapter = memoryAdapter()
			adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
			const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
			let now = 0
			store.now = () => now
			const onError = vi.fn()
			const engine = createEngine({
				store,
				queue: { concurrency: 4 },
				ttl: { aggregate: 60, realtime: 5 },
				timeoutMs: 15_000,
				onError,
			})

			const warm = await engine.read(adapter, q)
			expect(warm.meta.stale).toBeUndefined()

			now = 61_000 // past the 60s ttl, still inside the stale window
			const err = new Error('adapter down')
			// Non-HTTP failures get one retry, so keep rejecting through it.
			vi.spyOn(adapter, 'query').mockRejectedValue(err)
			const promise = engine.read(adapter, q)
			const assertion = expect(promise).resolves.toMatchObject({ meta: { stale: true } })

			await vi.advanceTimersByTimeAsync(1000)
			const result = await promise
			await assertion

			expect(result.meta.stale).toBe(true)
			expect(result.totals?.pageviews).toBe(warm.totals?.pageviews)
			expect(onError).toHaveBeenCalledTimes(1)
			expect(onError).toHaveBeenCalledWith(err, adapter.id)
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects on a failing adapter with a cold cache', async () => {
		vi.useFakeTimers()
		try {
			const { adapter, engine } = setup()
			const err = new Error('adapter down')
			// Non-HTTP failures get one retry, so keep rejecting through it.
			vi.spyOn(adapter, 'query').mockRejectedValue(err)
			const promise = engine.read(adapter, q)
			const assertion = expect(promise).rejects.toThrow('adapter down')

			await vi.advanceTimersByTimeAsync(1000)

			await assertion
		} finally {
			vi.useRealTimers()
		}
	})

	it('never marks a successful read as stale', async () => {
		const { adapter, engine } = setup()
		const result = await engine.read(adapter, q)
		expect(result.meta.stale).toBeUndefined()
	})

	it('does not clamp when maxLookbackDays is null', async () => {
		let received: { start: Date; end: Date } | undefined
		const adapter: AnalyticsAdapter = {
			id: 'unbounded',
			label: 'Unbounded',
			capabilities: { ...memoryAdapter().capabilities, maxLookbackDays: null },
			isConfigured: () => true,
			query: async (query) => {
				received = query.dateRange
				return {
					rows: [],
					totals: { pageviews: 5 },
					meta: { provider: 'unbounded', fetchedAt: '' },
				}
			},
		}
		const { engine } = setup()
		const start = new Date('2025-06-30T00:00:00.000Z')
		const end = new Date('2026-06-30T00:00:00.000Z')
		await engine.read(adapter, { metrics: ['pageviews'], dateRange: { start, end } })
		expect(received?.start.toISOString()).toBe(start.toISOString())
		expect(received?.end.toISOString()).toBe(end.toISOString())
	})

	it('aborts a hung adapter after timeoutMs and rejects with a cold cache', async () => {
		vi.useFakeTimers()
		try {
			let receivedSignal: AbortSignal | undefined
			const adapter: AnalyticsAdapter = {
				id: 'hung',
				label: 'Hung',
				capabilities: memoryAdapter().capabilities,
				isConfigured: () => true,
				// Mirrors a real fetch-based adapter: hangs until ctx.signal aborts, then rejects.
				query: (_query, ctx) => {
					receivedSignal = ctx.signal
					return new Promise((_resolve, reject) => {
						ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason))
					})
				},
			}
			const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
			const engine = createEngine({
				store,
				queue: { concurrency: 4 },
				ttl: { aggregate: 60, realtime: 5 },
				timeoutMs: 15_000,
			})

			const promise = engine.read(adapter, q)
			const assertion = expect(promise).rejects.toThrow('analytics: provider read timed out')

			await vi.advanceTimersByTimeAsync(15_000)

			await assertion
			expect(receivedSignal).toBeDefined()
			expect(receivedSignal?.aborted).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('stale-serves a hung adapter after timeoutMs when a warm cache entry exists', async () => {
		vi.useFakeTimers()
		try {
			const adapter = memoryAdapter()
			adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
			const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
			let now = 0
			store.now = () => now
			const engine = createEngine({
				store,
				queue: { concurrency: 4 },
				ttl: { aggregate: 60, realtime: 5 },
				timeoutMs: 15_000,
			})

			const warm = await engine.read(adapter, q)
			expect(warm.meta.stale).toBeUndefined()

			now = 61_000
			vi.spyOn(adapter, 'query').mockImplementation(
				(_query, ctx) =>
					new Promise((_resolve, reject) => {
						ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason))
					})
			)

			const promise = engine.read(adapter, q)
			const assertion = expect(promise).resolves.toMatchObject({ meta: { stale: true } })

			await vi.advanceTimersByTimeAsync(15_000)

			await assertion
		} finally {
			vi.useRealTimers()
		}
	})
})
