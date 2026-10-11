import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { createLocalReq, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { stateLease } from '../../src/maintenance/lease'
import { native } from '../../src/native/nativeAdapter'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { getRuntime } from '../../src/plugin/runtime'
import { CACHE_SLUG } from '../../src/surfacing/cacheCollection'
import { STALE_WINDOW_SECONDS } from '../../src/surfacing/cacheStore'
import { SWEEP_LEASE } from '../../src/surfacing/cacheSweep'
import { collectionCacheStore, TTL_INDEX_NAME } from '../../src/surfacing/collectionCacheStore'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { memoryCacheStore } from '../../src/testing/memoryCacheStore'
import { readForWidget } from '../../src/widgets/readForWidget'
import { readForWidgetRealtime } from '../../src/widgets/readForWidgetRealtime'
import { readerRequest } from './readerRequest'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const TTL = 60
const january = {
	start: new Date('2026-01-01T00:00:00.000Z'),
	end: new Date('2026-01-31T23:59:59.999Z'),
}
const queryOf = (path: string): AnalyticsQuery => ({
	path,
	metrics: ['pageviews'],
	dateRange: january,
})

const source = (): AnalyticsAdapter => {
	const adapter = memoryAdapter()
	adapter.record({ path: '/a', timestamp: new Date('2026-01-10T00:00:00.000Z') })
	return adapter
}

const plugin = (adapter: AnalyticsAdapter) =>
	analytics({
		adapters: [native(), adapter],
		capture: { gate: 'off' },
		cache: { ttl: { aggregate: TTL } },
	})

const runtimeOf = (payload: Payload) => {
	const runtime = getRuntime(payload)
	if (!runtime?.cache) {
		throw new Error('the analytics runtime is not built')
	}
	return { ...runtime, cache: runtime.cache }
}

const rows = async (payload: Payload) =>
	(
		await payload.db.find<{ id: string | number; key: string; fetchedAt: unknown }>({
			collection: CACHE_SLUG,
			limit: 0,
			pagination: false,
			req: {},
		})
	).docs

const clear = (payload: Payload) =>
	payload.db.deleteMany({ collection: CACHE_SLUG, req: {}, where: {} })

/** One stored value, with the background sweep its write may have started already settled. */
const storedValue = async (payload: Payload, adapter: AnalyticsAdapter, path: string) => {
	const runtime = runtimeOf(payload)
	const value = await runtime.engine.read(adapter, queryOf(path))
	await runtime.engine.idle?.()
	await runtime.cache.sweeper.idle()
	await clear(payload)
	return value
}

describeForDb('analytics read cache', {}, (db) => {
	let booted: BootedPayload
	let second: BootedPayload
	let clock: TestClock
	const adapter = source()

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({ db, plugin: plugin(adapter) })
		second = await bootPayload({ db, plugin: plugin(source()), attachTo: booted })
	}, 240_000)

	afterEach(async () => {
		vi.restoreAllMocks()
		for (const each of [booted, second]) {
			const runtime = getRuntime(each.payload)
			await runtime?.engine.idle?.()
			await runtime?.cache?.sweeper.idle()
		}
	})

	afterAll(async () => {
		clock?.reset()
		await second?.stop()
		await booted?.stop()
	})

	it(`registers the cache collection closed to every request on ${db}`, async () => {
		const config = booted.payload.collections[CACHE_SLUG]?.config
		for (const operation of ['read', 'create', 'update', 'delete'] as const) {
			const access = config?.access[operation]
			expect(await access?.({ req: readerRequest(booted.payload) } as never)).toBe(false)
		}
		expect(config?.admin.hidden).toBe(true)
		expect(config?.endpoints).toBe(false)
		expect(config?.graphQL).toBe(false)
		expect(config?.timestamps).toBe(false)
		expect(config?.lockDocuments).toBe(false)
		const fields = (config?.fields ?? []).flatMap((field) => ('name' in field ? [field.name] : []))
		expect(fields).toEqual(
			expect.arrayContaining([
				'key',
				'value',
				'owner',
				'expiresAt',
				'staleUntil',
				'readAt',
				'recipe',
			])
		)
	})

	it.runIf(db === 'mongo')('creates the TTL index on staleUntil on mongo', async () => {
		const models: unknown = Reflect.get(booted.payload.db, 'collections')
		const model = (models as Record<string, { collection: { indexes(): Promise<unknown[]> } }>)[
			CACHE_SLUG
		]
		const indexes = (await model?.collection.indexes()) as Array<{
			name: string
			key: Record<string, number>
			expireAfterSeconds?: number
		}>
		const ttl = indexes.find((index) => index.name === TTL_INDEX_NAME)
		expect(ttl?.key).toEqual({ staleUntil: 1 })
		expect(ttl?.expireAfterSeconds).toBe(0)
	})

	it(`serves fresh, then stale while refreshing, then misses past staleUntil on ${db}`, async () => {
		const spy = vi.spyOn(adapter, 'query')
		const { engine } = runtimeOf(booted.payload)
		const q = queryOf('/fresh')
		expect((await engine.read(adapter, q)).totals?.pageviews).toBe(0)
		expect(spy).toHaveBeenCalledTimes(1)
		// The answer is written in the background, after the read answered.
		await engine.idle?.()
		const stored = await rows(booted.payload)
		expect(stored).toHaveLength(1)
		expect(stored[0]?.key).toMatch(/^r:/)

		// Past the 15 s memo: the entry comes back from the collection, still fresh.
		clock.advance(16_000)
		const fresh = await engine.read(adapter, q)
		expect(fresh.meta.stale).toBeUndefined()
		expect(spy).toHaveBeenCalledTimes(1)

		// Past the TTL: answered at once from the expired entry, while one refresh runs.
		clock.advance(TTL * 1000)
		const stale = await engine.read(adapter, q)
		expect(stale.meta.stale).toBe(true)
		expect(stale.meta.asOf).toBe(NOW.toISOString())
		await engine.idle?.()
		expect(spy).toHaveBeenCalledTimes(2)
		const refreshed = await engine.read(adapter, q)
		expect(refreshed.meta.stale).toBeUndefined()

		// Past staleUntil: a miss, which waits for the source.
		clock.advance((TTL + STALE_WINDOW_SECONDS) * 1000 + 1)
		const missed = await engine.read(adapter, q)
		expect(missed.meta.stale).toBeUndefined()
		expect(spy).toHaveBeenCalledTimes(3)
	})

	it(`shares one entry between two instances storing one key at once on ${db}`, async () => {
		const value = await storedValue(booted.payload, adapter, '/race')
		const stores = [booted, second].map((each) =>
			collectionCacheStore(each.payload, { slug: CACHE_SLUG })
		)
		await Promise.all(
			stores.map((store) => store.set('race', value, { ttlSeconds: TTL, staleSeconds: 60 }))
		)
		expect((await rows(booted.payload)).filter((row) => row.key === 'race')).toHaveLength(1)
		expect((await stores[1]?.get('race'))?.value).toEqual(value)
	})

	it(`sweeps at most a batch of expired entries and keeps the live ones on ${db}`, async () => {
		const store = collectionCacheStore(booted.payload, { slug: CACHE_SLUG })
		const value = await storedValue(booted.payload, adapter, '/sweep')
		for (let i = 0; i < 5; i++) {
			await store.set(`old-${i}`, value, { ttlSeconds: 1, staleSeconds: 1 })
		}
		clock.advance(10_000)
		await store.set('live-1', value, { ttlSeconds: 1, staleSeconds: 60 })
		await store.set('live-2', value, { ttlSeconds: 60, staleSeconds: 60 })
		const now = new Date(clock.now())
		expect(await store.sweep(now, 3)).toBe(3)
		expect(await store.sweep(now, 3)).toBe(2)
		expect(await store.sweep(now, 3)).toBe(0)
		expect((await rows(booted.payload)).map((row) => row.key).sort()).toEqual(['live-1', 'live-2'])
	})

	it(`lets one of two instances hold the sweep lease, and the other skip on ${db}`, async () => {
		const leases = [booted, second].map((each) => stateLease(each.payload, SWEEP_LEASE, 60_000))
		const claims = await Promise.all(leases.map((lease) => lease?.claim()))
		expect(claims.filter((won) => won === true)).toHaveLength(1)
		const winner = claims[0] === true ? 0 : 1
		const loser = [booted, second][1 - winner]
		if (!loser) {
			throw new Error('two instances were booted')
		}
		expect(await runtimeOf(loser.payload).cache.sweeper.sweep()).toEqual({ ran: false, swept: 0 })
		await leases[winner]?.release()
		expect((await runtimeOf(loser.payload).cache.sweeper.sweep()).ran).toBe(true)
	})

	it(`sweeps expired entries in the analytics-maintain task on ${db}`, async () => {
		const store = collectionCacheStore(booted.payload, { slug: CACHE_SLUG })
		const value = await storedValue(booted.payload, adapter, '/task')
		for (let i = 0; i < 4; i++) {
			await store.set(`expired-${i}`, value, { ttlSeconds: 1, staleSeconds: 1 })
		}
		clock.advance(5_000)
		const task = booted.payload.config.jobs.tasks?.find((each) => each.slug === MAINTAIN_TASK_SLUG)
		const handler = task?.handler
		if (typeof handler !== 'function') {
			throw new Error('analytics-maintain has no handler')
		}
		const req = await createLocalReq({}, booted.payload)
		const result = await handler({ input: {}, req } as unknown as Parameters<typeof handler>[0])
		expect((result as { output: { sweptCache: number } }).output.sweptCache).toBe(4)
		expect(await rows(booted.payload)).toHaveLength(0)
	})

	it(`keeps live counts in memory and writes none of them to the store on ${db}`, async () => {
		const before = await rows(booted.payload)
		const kvBefore = await booted.payload.kv.keys()
		const runtime = runtimeOf(booted.payload)
		const read = () =>
			readForWidgetRealtime({
				req: readerRequest(booted.payload),
				metric: 'visitors',
				windowMinutes: 30,
				adapterId: 'native',
				now: new Date(clock.now()),
			})
		const first = await read()
		expect(first.status).toBe('ok')
		const memoized = runtime.memo?.size ?? 0
		expect(await read()).toEqual(first)
		expect(runtime.memo?.size).toBe(memoized)
		expect(await rows(booted.payload)).toHaveLength(before.length)
		expect(await booted.payload.kv.keys()).toEqual(kvBefore)
	})

	it(`answers a read whose cache write and cache read fail on ${db}`, async () => {
		const { engine } = runtimeOf(booted.payload)
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		vi.spyOn(booted.payload.db, 'upsert').mockRejectedValue(
			Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
		)
		vi.spyOn(booted.payload.db, 'findOne').mockRejectedValue(new Error('connection reset'))
		const result = await engine.read(adapter, queryOf('/unwritable'))
		expect(result.totals?.pageviews).toBe(0)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('the read cache failed'))
	})
})

describeForDb('analytics read cache: a store of the host', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const store = memoryCacheStore({ now: () => clock.now().getTime() })
	const adapter = source()

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [adapter], cache: { store, ttl: { aggregate: TTL } } }),
		})
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`registers no cache collection and reads through the host's store on ${db}`, async () => {
		expect(booted.payload.collections[CACHE_SLUG]).toBeUndefined()
		const spy = vi.spyOn(adapter, 'query')
		const read = () =>
			readForWidget({
				req: readerRequest(booted.payload),
				metrics: ['pageviews'],
				timeframe: 'last30days',
				now: new Date(clock.now()),
			})
		expect((await read()).status).toBe('ok')
		const stored = store.entries.size
		expect(stored).toBeGreaterThan(0)
		const calls = spy.mock.calls.length
		// Past the in-process memo, so the second render reads the host's store.
		clock.advance(16_000)
		const get = vi.spyOn(store, 'get')
		expect((await read()).status).toBe('ok')
		expect(spy.mock.calls.length).toBe(calls)
		expect(get).toHaveBeenCalled()
		expect(store.entries.size).toBe(stored)
	})
})

describeForDb('analytics read cache: a renamed collection', {}, (db) => {
	let booted: BootedPayload
	const adapter = source()

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				cache: {
					collection: {
						slug: 'read-cache',
						overrides: (collection) => ({
							...collection,
							labels: { singular: 'Read', plural: 'Reads' },
						}),
					},
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`stores reads under the slug the host chose on ${db}`, async () => {
		expect(booted.payload.collections[CACHE_SLUG]).toBeUndefined()
		expect(booted.payload.collections['read-cache']?.config.labels.plural).toBe('Reads')
		const { engine } = runtimeOf(booted.payload)
		await engine.read(adapter, queryOf('/renamed'))
		await engine.idle?.()
		const stored = await booted.payload.db.find({
			collection: 'read-cache',
			limit: 0,
			pagination: false,
			req: {},
		})
		expect(stored.docs).toHaveLength(1)
	})
})
