import { inMemoryKVAdapter, type Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { type CacheStore, STALE_WINDOW_SECONDS } from './cacheStore'
import { PROVIDER_READ_TIMEOUT_MESSAGE } from './classifyError'
import { createEngine, type EngineOptions } from './engine'
import { createEpochStore } from './epoch'
import { AGGREGATE_MEMO_MS } from './memo'

const q: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

/** Past the 60 s TTL the setups use, and past the 15 s memo. */
const EXPIRED_AT = 61_000

const recorded = () => {
	const adapter = memoryAdapter()
	adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
	return adapter
}

/** An engine and a store sharing one hand-moved clock. */
const setup = (extra: Partial<EngineOptions> = {}) => {
	const clock = { at: 0 }
	const now = () => clock.at
	const adapter = recorded()
	const store = memoryCacheStore({ now })
	const engine = createEngine({
		store,
		ttl: { aggregate: 60, realtime: 5 },
		timeoutMs: 15_000,
		now,
		...extra,
	})
	return { adapter, engine, store, clock }
}

const hanging = (_query: AnalyticsQuery, ctx: { signal?: AbortSignal }): Promise<AnalyticsResult> =>
	new Promise((_resolve, reject) => {
		ctx.signal?.addEventListener('abort', () => reject(ctx.signal?.reason))
	})

describe('createEngine', () => {
	it('returns adapter data on cold miss and caches it', async () => {
		const { adapter, engine, store } = setup()
		const spy = vi.spyOn(adapter, 'query')
		const a = await engine.read(adapter, q)
		const b = await engine.read(adapter, q)
		expect(a.totals?.pageviews).toBe(1)
		expect(b.totals?.pageviews).toBe(1)
		expect(spy).toHaveBeenCalledTimes(1)
		expect(store.entries.size).toBe(1)
	})

	it('dates an answer to when its source was read, which a cached answer keeps', async () => {
		const { adapter, engine, clock } = setup()
		clock.at = 5_000
		const first = await engine.read(adapter, q)
		expect(first.meta.fetchedAt).toBe(new Date(5_000).toISOString())
		clock.at = 30_000
		const cached = await engine.read(adapter, q)
		expect(cached.meta.fetchedAt).toBe(new Date(5_000).toISOString())
	})

	it("stamps the read's own moment over a fetchedAt the source dated later or not at all", async () => {
		const { engine, clock } = setup()
		clock.at = 7_000
		const datedAhead: AnalyticsAdapter = {
			...memoryAdapter(),
			id: 'ahead',
			query: async (query) => ({
				rows: [],
				meta: { provider: 'ahead', fetchedAt: query.dateRange.end.toISOString() },
			}),
		}
		const read = await engine.read(datedAhead, q)
		expect(read.meta.fetchedAt).toBe(new Date(7_000).toISOString())
		const unconfigured = { ...memoryAdapter(), id: 'off', isConfigured: () => false }
		expect((await engine.read(unconfigured, q)).meta.fetchedAt).toBe(new Date(7_000).toISOString())
	})

	describe("a source bounding today's answers", () => {
		const DAY = 86_400_000
		/** Native's shape: cheap reads, today's answers fresh for 10 seconds. */
		const nativeLike = (adapter: AnalyticsAdapter): AnalyticsAdapter => ({
			...adapter,
			capabilities: {
				...adapter.capabilities,
				recommendedTtl: { realtime: 10, aggregate: 300, today: 10 },
			},
		})
		const throughToday = (at: number): AnalyticsQuery => ({
			metrics: ['pageviews'],
			dateRange: { start: new Date(at - 7 * DAY), end: new Date(at) },
		})

		it('keeps a window reaching into today fresh for its bound, whatever cache.ttl says', async () => {
			const { adapter, engine, store, clock } = setup({ ttl: { aggregate: 3600, realtime: 5 } })
			const source = nativeLike(adapter)
			clock.at = 30 * DAY
			const spy = vi.spyOn(source, 'query')
			const visitors = { ...throughToday(clock.at), metrics: ['visitors' as const] }
			await engine.read(source, visitors)
			const [entry] = [...store.entries.values()]
			expect((entry?.expiresAt ?? 0) - clock.at).toBe(10_000)
			clock.at += 11_000
			const again = await engine.read(source, visitors)
			// Read again before answering: never the expired entry while a refresh runs.
			expect(spy).toHaveBeenCalledTimes(2)
			expect(again.meta.stale).toBeUndefined()
		})

		it('keeps the closed days of an event count for the aggregate TTL and reads only today again', async () => {
			const { adapter, engine, store, clock } = setup({ ttl: { aggregate: 300, realtime: 5 } })
			const source = nativeLike(adapter)
			clock.at = 30 * DAY + 12 * 3_600_000
			adapter.record({ path: '/a', timestamp: new Date(27 * DAY) })
			adapter.record({ path: '/b', timestamp: new Date(30 * DAY + 3_600_000) })
			const spy = vi.spyOn(source, 'query')
			const query: AnalyticsQuery = {
				metrics: ['pageviews'],
				dateRange: { start: new Date(25 * DAY), end: new Date(clock.at) },
			}
			const first = await engine.read(source, query)
			expect(first.totals?.pageviews).toBe(2)
			expect(spy).toHaveBeenCalledTimes(2)
			const asked = spy.mock.calls.map(([part]) => part.dateRange.end.getTime())
			expect(asked).toContain(30 * DAY - 1)
			const kept = [...store.entries.values()].map((entry) => entry.expiresAt - clock.at).sort()
			expect(kept).toEqual([10_000, 300_000])
			adapter.record({ path: '/c', timestamp: new Date(30 * DAY + 7_200_000) })
			clock.at += 11_000
			const again = await engine.read(source, query)
			expect(again.totals?.pageviews).toBe(3)
			expect(spy).toHaveBeenCalledTimes(3)
			expect(spy.mock.calls[2]?.[0].dateRange.start.getTime()).toBe(30 * DAY)
		})

		it('reads a day series of event counts in two halves and answers its days in order', async () => {
			const { adapter, engine, clock } = setup()
			const source = nativeLike(adapter)
			clock.at = 30 * DAY + 6 * 3_600_000
			adapter.record({ path: '/a', timestamp: new Date(29 * DAY + 3_600_000) })
			adapter.record({ path: '/b', timestamp: new Date(30 * DAY + 3_600_000) })
			const series = await engine.read(source, {
				metrics: ['pageviews'],
				granularity: 'day',
				dateRange: { start: new Date(28 * DAY), end: new Date(clock.at) },
			})
			const days = series.rows.filter((row) => row.metrics.pageviews === 1)
			expect(days.map((row) => Date.parse(row.timestamp ?? ''))).toEqual([29 * DAY, 30 * DAY])
		})

		it('keeps a closed window, and every vendor read, to the usual TTL', async () => {
			const { adapter, engine, store, clock } = setup()
			clock.at = 30 * DAY
			const closed: AnalyticsQuery = {
				metrics: ['pageviews'],
				dateRange: { start: new Date(20 * DAY), end: new Date(21 * DAY - 1) },
			}
			await engine.read(nativeLike(adapter), closed)
			await engine.read(adapter, throughToday(clock.at))
			const kept = [...store.entries.values()].map((entry) => entry.expiresAt - clock.at)
			expect(kept).toEqual([60_000, 60_000])
		})
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

	it('starts a source that declares no lookback no earlier than 1970, and says so', async () => {
		let received: { start: Date; end: Date } | undefined
		const adapter: AnalyticsAdapter = {
			...memoryAdapter(),
			id: 'unbounded',
			capabilities: { ...memoryAdapter().capabilities, maxLookbackDays: null },
			query: async (query) => {
				received = query.dateRange
				return { rows: [], meta: { provider: 'unbounded', fetchedAt: '' } }
			},
		}
		const { engine } = setup()
		const end = new Date('2026-10-08T21:59:59.999Z')
		const res = await engine.read(adapter, {
			metrics: ['pageviews'],
			dateRange: { start: new Date('0999-12-31T23:06:32.000Z'), end },
		})
		expect(received?.start.toISOString()).toBe('1970-01-01T00:00:00.000Z')
		expect(received?.end).toEqual(end)
		expect(res.meta).toMatchObject({ clamped: true, dataFrom: '1970-01-01T00:00:00.000Z' })
	})

	it('asks for a limited breakdown with no order ranked by its first metric', async () => {
		let received: AnalyticsQuery | undefined
		const adapter: AnalyticsAdapter = {
			...memoryAdapter(),
			query: async (query) => {
				received = query
				return { rows: [], meta: { provider: 'memory', fetchedAt: '' } }
			},
		}
		const { engine } = setup()
		await engine.read(adapter, {
			metrics: ['visitors', 'pageviews'],
			dimensions: ['page'],
			limit: 10,
			dateRange: q.dateRange,
		})
		expect(received?.order).toEqual({ metric: 'visitors', direction: 'desc' })
		await engine.read(adapter, { metrics: ['visitors'], limit: 10, dateRange: q.dateRange })
		expect(received?.order).toBeUndefined()
	})

	it('never marks a successful read as stale', async () => {
		const { adapter, engine } = setup()
		const result = await engine.read(adapter, q)
		expect(result.meta.stale).toBeUndefined()
	})

	it('rejects on a failing adapter with a cold cache', async () => {
		vi.useFakeTimers()
		try {
			const { adapter, engine } = setup()
			// A network failure is an outage, retried twice with backoff, so keep rejecting through both.
			vi.spyOn(adapter, 'query').mockRejectedValue(new Error('adapter down'))
			const promise = engine.read(adapter, q)
			const assertion = expect(promise).rejects.toThrow('adapter down')
			await vi.advanceTimersByTimeAsync(2000)
			await assertion
		} finally {
			vi.useRealTimers()
		}
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
				query: (query, ctx) => {
					receivedSignal = ctx.signal
					return hanging(query, ctx)
				},
			}
			const { engine } = setup()
			const promise = engine.read(adapter, q)
			const assertion = expect(promise).rejects.toThrow(PROVIDER_READ_TIMEOUT_MESSAGE)
			await vi.advanceTimersByTimeAsync(15_000)
			await assertion
			expect(receivedSignal?.aborted).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects at timeoutMs even when the adapter never checks ctx.signal (cold cache)', async () => {
		vi.useFakeTimers()
		try {
			const adapter: AnalyticsAdapter = {
				id: 'blind',
				label: 'Blind',
				capabilities: memoryAdapter().capabilities,
				isConfigured: () => true,
				// Truly signal-blind: never resolves, never listens to ctx.signal at all.
				query: () => new Promise(() => {}),
			}
			const { engine } = setup()
			const promise = engine.read(adapter, q)
			const assertion = expect(promise).rejects.toThrow(PROVIDER_READ_TIMEOUT_MESSAGE)
			await vi.advanceTimersByTimeAsync(15_000)
			await assertion
		} finally {
			vi.useRealTimers()
		}
	})

	it('enforces a declared per-adapter rate limit across concurrent reads for distinct queries', async () => {
		vi.useFakeTimers()
		try {
			const base = memoryAdapter()
			base.record({ path: '/a', timestamp: new Date('2026-01-10') })
			base.record({ path: '/b', timestamp: new Date('2026-01-10') })
			base.record({ path: '/c', timestamp: new Date('2026-01-10') })
			const adapter: AnalyticsAdapter = {
				...base,
				capabilities: { ...base.capabilities, rateLimit: { requestsPerMinute: 2 } },
			}
			const { engine } = setup({ timeoutMs: 60_000 }) // longer than the 30s refill wait below

			const settled: string[] = []
			const track = (label: string, p: Promise<AnalyticsResult>): Promise<AnalyticsResult> =>
				p.then((r) => {
					settled.push(label)
					return r
				})

			const a = track('a', engine.read(adapter, { ...q, path: '/a' }))
			const b = track('b', engine.read(adapter, { ...q, path: '/b' }))
			const c = track('c', engine.read(adapter, { ...q, path: '/c' }))

			await vi.advanceTimersByTimeAsync(0)
			expect(settled.sort()).toEqual(['a', 'b'])

			await vi.advanceTimersByTimeAsync(29_999)
			expect(settled).not.toContain('c')

			await vi.advanceTimersByTimeAsync(1)
			await c
			expect(settled).toContain('c')

			await Promise.all([a, b, c])
		} finally {
			vi.useRealTimers()
		}
	})

	it('rejects at timeoutMs when it elapses while waiting on the adapter rate limiter (cold cache)', async () => {
		vi.useFakeTimers()
		try {
			const base = memoryAdapter()
			const adapter: AnalyticsAdapter = {
				...base,
				capabilities: { ...base.capabilities, rateLimit: { requestsPerMinute: 1 } },
			}
			const spy = vi.spyOn(adapter, 'query')
			const { engine } = setup()

			// Spends the adapter's single per-minute token so the next read must wait on it.
			await engine.read(adapter, { ...q, path: '/warm' })
			expect(spy).toHaveBeenCalledTimes(1)

			const promise = engine.read(adapter, { ...q, path: '/blocked' })
			const assertion = expect(promise).rejects.toThrow(PROVIDER_READ_TIMEOUT_MESSAGE)
			await vi.advanceTimersByTimeAsync(15_000)
			await assertion
			// Still 1: the abort fired while waiting on the limiter, before the adapter was ever called.
			expect(spy).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('createEngine stale serving', () => {
	it('answers an expired entry at once, flagged stale and dated, while one refresh runs', async () => {
		const { adapter, engine, store, clock } = setup()
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, q)
		clock.at = EXPIRED_AT
		const reads = await Promise.all([engine.read(adapter, q), engine.read(adapter, q)])
		for (const stale of reads) {
			expect(stale.meta.stale).toBe(true)
			expect(stale.meta.asOf).toBe(new Date(0).toISOString())
			expect(stale.totals?.pageviews).toBe(1)
		}
		await engine.idle()
		expect(spy).toHaveBeenCalledTimes(2)
		expect([...store.entries.values()][0]?.fetchedAt).toBe(EXPIRED_AT)
		const fresh = await engine.read(adapter, q)
		expect(fresh.meta.stale).toBeUndefined()
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('keeps an older asOf the value already carried', async () => {
		const asOf = '2025-12-31T00:00:00.000Z'
		const adapter: AnalyticsAdapter = {
			...recorded(),
			query: async () => ({
				rows: [],
				totals: {},
				meta: { provider: 'memory', fetchedAt: '', asOf },
			}),
		}
		const { engine, clock } = setup()
		const fetchedAt = Date.parse('2026-02-01T00:00:00.000Z')
		clock.at = fetchedAt
		await engine.read(adapter, q)
		clock.at = fetchedAt + EXPIRED_AT
		expect((await engine.read(adapter, q)).meta.asOf).toBe(asOf)
		await engine.idle()
	})

	it('keeps answering the expired entry while its refresh fails, reporting each failure once', async () => {
		vi.useFakeTimers()
		try {
			const onError = vi.fn()
			const { adapter, engine, clock } = setup({ onError })
			await engine.read(adapter, q)
			clock.at = EXPIRED_AT
			const err = new Error('adapter down')
			vi.spyOn(adapter, 'query').mockRejectedValue(err)
			const stale = await engine.read(adapter, q)
			expect(stale.meta.stale).toBe(true)
			await vi.advanceTimersByTimeAsync(2000)
			await engine.idle()
			expect(onError).toHaveBeenCalledTimes(1)
			expect(onError).toHaveBeenCalledWith(err, adapter.id)
			expect((await engine.read(adapter, q)).meta.stale).toBe(true)
			await vi.advanceTimersByTimeAsync(2000)
			await engine.idle()
		} finally {
			vi.useRealTimers()
		}
	})

	it('answers at once rather than waiting out timeoutMs on a hung source', async () => {
		vi.useFakeTimers()
		try {
			const { adapter, engine, clock } = setup()
			await engine.read(adapter, q)
			clock.at = EXPIRED_AT
			vi.spyOn(adapter, 'query').mockImplementation(hanging)
			expect((await engine.read(adapter, q)).meta.stale).toBe(true)
			await vi.advanceTimersByTimeAsync(15_000)
			await engine.idle()
		} finally {
			vi.useRealTimers()
		}
	})

	it('reads an entry past its staleUntil as a miss, waiting for the source', async () => {
		const { adapter, engine, clock } = setup()
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, q)
		clock.at = 60_000 + STALE_WINDOW_SECONDS * 1000
		const result = await engine.read(adapter, q)
		expect(result.meta.stale).toBeUndefined()
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('without allowStale, waits for the refresh and answers it', async () => {
		const { adapter, engine, clock } = setup()
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, q)
		clock.at = EXPIRED_AT
		const result = await engine.read(adapter, q, { allowStale: false })
		expect(result.meta.stale).toBeUndefined()
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('without allowStale, falls back to the expired entry when the refresh fails', async () => {
		vi.useFakeTimers()
		try {
			const onError = vi.fn()
			const { adapter, engine, clock } = setup({ onError })
			await engine.read(adapter, q)
			clock.at = EXPIRED_AT
			vi.spyOn(adapter, 'query').mockRejectedValue(new Error('adapter down'))
			const promise = engine.read(adapter, q, { allowStale: false })
			const assertion = expect(promise).resolves.toMatchObject({ meta: { stale: true } })
			await vi.advanceTimersByTimeAsync(2000)
			await assertion
			expect(onError).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})

	it('without allowStale, falls back at timeoutMs on a hung or signal-blind source', async () => {
		vi.useFakeTimers()
		try {
			for (const query of [hanging, () => new Promise<never>(() => {})]) {
				const { adapter, engine, clock } = setup()
				await engine.read(adapter, q)
				clock.at = EXPIRED_AT
				vi.spyOn(adapter, 'query').mockImplementation(query)
				const promise = engine.read(adapter, q, { allowStale: false })
				const assertion = expect(promise).resolves.toMatchObject({ meta: { stale: true } })
				await vi.advanceTimersByTimeAsync(15_000)
				await assertion
			}
		} finally {
			vi.useRealTimers()
		}
	})

	it('without allowStale, falls back when timeoutMs elapses on the rate limiter', async () => {
		vi.useFakeTimers()
		try {
			const base = recorded()
			const adapter: AnalyticsAdapter = {
				...base,
				capabilities: { ...base.capabilities, rateLimit: { requestsPerMinute: 1 } },
			}
			const { engine, clock } = setup()
			await engine.read(adapter, q)
			clock.at = EXPIRED_AT // past the 60s ttl; the single per-minute token stays spent
			const spy = vi.spyOn(adapter, 'query')
			const promise = engine.read(adapter, q, { allowStale: false })
			const assertion = expect(promise).resolves.toMatchObject({ meta: { stale: true } })
			await vi.advanceTimersByTimeAsync(15_000)
			await assertion
			expect(spy).not.toHaveBeenCalled()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('createEngine memo and store failures', () => {
	it('answers a repeated read from memory for 15 seconds before asking the store again', async () => {
		const { adapter, engine, store, clock } = setup()
		const get = vi.spyOn(store, 'get')
		await engine.read(adapter, q)
		await engine.read(adapter, q)
		expect(get).toHaveBeenCalledTimes(1)
		clock.at = AGGREGATE_MEMO_MS
		await engine.read(adapter, q)
		expect(get).toHaveBeenCalledTimes(2)
	})

	it('keeps its memo to itself: a second engine on the same store asks the store', async () => {
		const first = setup()
		await first.engine.read(first.adapter, q)
		const second = createEngine({
			store: first.store,
			ttl: { aggregate: 60 },
			timeoutMs: 15_000,
			now: () => first.clock.at,
		})
		const spy = vi.spyOn(first.adapter, 'query')
		const get = vi.spyOn(first.store, 'get')
		expect((await second.read(first.adapter, q)).totals?.pageviews).toBe(1)
		expect(get).toHaveBeenCalledTimes(1)
		expect(spy).not.toHaveBeenCalled()
	})

	it('reads through to the source when the store fails, and answers when the write fails too', async () => {
		const onStoreError = vi.fn()
		const broken: CacheStore = {
			...memoryCacheStore(),
			get: async () => Promise.reject(new Error('busy')),
			set: async () => Promise.reject(new Error('SQLITE_BUSY')),
		}
		const { adapter, engine } = setup({ store: broken, onStoreError })
		const result = await engine.read(adapter, q)
		expect(result.totals?.pageviews).toBe(1)
		expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), 'get')
		expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), 'set')
	})

	it('reads a stored value of another shape as a miss', async () => {
		const store = memoryCacheStore()
		const odd: CacheStore = {
			...store,
			get: async () => ({
				value: { rows: 'x' } as never,
				fetchedAt: 0,
				expiresAt: 9e15,
				staleUntil: 9e15,
			}),
		}
		const { adapter, engine } = setup({ store: odd })
		const spy = vi.spyOn(adapter, 'query')
		expect((await engine.read(adapter, q)).totals?.pageviews).toBe(1)
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('tells its owner about each value the store accepted', async () => {
		const onWrite = vi.fn()
		const { adapter, engine } = setup({ onWrite })
		await engine.read(adapter, q)
		await engine.read(adapter, q)
		expect(onWrite).toHaveBeenCalledTimes(1)
	})
})

describe('createEngine ttls', () => {
	const recordingStore = (): { store: CacheStore; writes: number[] } => {
		const writes: number[] = []
		return {
			writes,
			store: {
				...memoryCacheStore(),
				get: async () => null,
				set: async (_key, _value, opts) => {
					writes.push(opts.ttlSeconds)
				},
			},
		}
	}

	const goalAdapter = (meta: AnalyticsResult['meta']): AnalyticsAdapter => ({
		id: 'degraded',
		label: 'Degraded',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query: async () => ({ rows: [], totals: {}, meta }),
	})

	const goalQuery: AnalyticsQuery = {
		metrics: ['conversions'],
		dimensions: ['goal'],
		dateRange: q.dateRange,
		goalSlugs: ['signup'],
	}

	const engineOn = (store: CacheStore) => createEngine({ store, ttl: {}, timeoutMs: 15_000 })

	it('caches a failed goal read for the realtime ttl, not the aggregate one', async () => {
		const { store, writes } = recordingStore()
		await engineOn(store).read(
			goalAdapter({ provider: 'degraded', fetchedAt: '', goalsUnresolved: true }),
			goalQuery
		)
		expect(writes).toEqual([300])
	})

	// Every `goalsUnresolved` answer is a failure: a scope with no goals answers empty rows
	// instead, so the flag never stands for stable configuration.
	it('caches a failed goal read for the realtime ttl whatever hint it carried', async () => {
		for (const goalSlugs of [[], 'unresolved' as const, undefined]) {
			const { store, writes } = recordingStore()
			await engineOn(store).read(
				goalAdapter({ provider: 'degraded', fetchedAt: '', goalsUnresolved: true }),
				{ ...goalQuery, goalSlugs }
			)
			expect(writes).toEqual([300])
		}
	})

	it('keeps the aggregate ttl for a goal read the provider answered', async () => {
		const { store, writes } = recordingStore()
		await engineOn(store).read(goalAdapter({ provider: 'degraded', fetchedAt: '' }), goalQuery)
		expect(writes).toEqual([3600])
	})

	it('caches a read that left days uncounted for the realtime ttl, and a capped one for the aggregate', async () => {
		const partial = recordingStore()
		await engineOn(partial.store).read(
			goalAdapter({ provider: 'degraded', fetchedAt: '', partial: { missingDays: 2 } }),
			goalQuery
		)
		expect(partial.writes).toEqual([300])
		const capped = recordingStore()
		await engineOn(capped.store).read(
			goalAdapter({ provider: 'degraded', fetchedAt: '', capped: { days: 2 } }),
			goalQuery
		)
		expect(capped.writes).toEqual([3600])
	})
})

describe('createEngine cache epochs', () => {
	const scoped = (scope: string): AnalyticsQuery => ({ ...q, scope })

	const setupWithEpoch = (config?: (scope?: string | null) => Promise<string>) => {
		const payload = {
			kv: inMemoryKVAdapter().init({} as never),
			logger: { warn: () => {} },
		} as unknown as Payload
		const epoch = createEpochStore(payload)
		return { epoch, ...setup({ epoch, ...(config ? { configEpoch: config } : {}) }) }
	}

	it('makes a read after a bump miss the cache and query the adapter again', async () => {
		const { adapter, engine, epoch } = setupWithEpoch()
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, scoped('tenant-a'))
		await engine.read(adapter, scoped('tenant-a'))
		expect(spy).toHaveBeenCalledTimes(1)

		await epoch.bump('tenant-a')
		await engine.read(adapter, scoped('tenant-a'))
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('leaves the cached entry of another scope alone', async () => {
		const { adapter, engine, epoch } = setupWithEpoch()
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, scoped('tenant-a'))
		await engine.read(adapter, scoped('tenant-b'))
		expect(spy).toHaveBeenCalledTimes(2)

		await epoch.bump('tenant-b')
		await engine.read(adapter, scoped('tenant-a'))
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('misses the cache once the configuration epoch moves', async () => {
		let config = 'c1'
		const { adapter, engine } = setupWithEpoch(async () => config)
		const spy = vi.spyOn(adapter, 'query')
		await engine.read(adapter, scoped('tenant-a'))
		await engine.read(adapter, scoped('tenant-a'))
		config = 'c2'
		await engine.read(adapter, scoped('tenant-a'))
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('still coalesces two concurrent reads inside one epoch into one adapter call', async () => {
		const { adapter, engine } = setupWithEpoch()
		const spy = vi.spyOn(adapter, 'query')
		const [a, b] = await Promise.all([
			engine.read(adapter, scoped('tenant-a')),
			engine.read(adapter, scoped('tenant-a')),
		])
		expect(spy).toHaveBeenCalledTimes(1)
		expect(a.totals?.pageviews).toBe(b.totals?.pageviews)
	})
})
