import { describe, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import type { CacheEntry, CacheStore } from './cacheStore'
import { classifyError } from './classifyError'
import { type CacheOperation, createEngine, type EngineOptions } from './engine'
import { createEpochFallback } from './epoch'
import { createLanes } from './lanes'

const q: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews'],
	scope: 't1',
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31T23:59:59.999Z') },
}

const answer = (pageviews = 1): AnalyticsResult => ({
	rows: [],
	totals: { pageviews },
	meta: { provider: 'vendor', fetchedAt: '2026-01-31T00:00:00.000Z' },
})

const vendor = (query: AnalyticsAdapter['query'], id = 'vendor'): AnalyticsAdapter => ({
	id,
	label: 'Vendor',
	capabilities: { ...memoryAdapter().capabilities, rateLimit: null },
	isConfigured: () => true,
	query,
})

/** Settles to whether `p` settled within `ms`, without leaving it unhandled. */
const settlesWithin = async (p: Promise<unknown>, ms: number): Promise<boolean> =>
	Promise.race([
		p.then(
			() => true,
			() => true
		),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
	])

const setup = (extra: Partial<EngineOptions> = {}) => {
	const clock = { at: 0 }
	const now = () => clock.at
	const store = memoryCacheStore({ now })
	const storeErrors: Array<[string, CacheOperation]> = []
	const engine = createEngine({
		store,
		ttl: { aggregate: 60 },
		timeoutMs: 200,
		now,
		onStoreError: (err, operation) => storeErrors.push([String(err), operation]),
		...extra,
	})
	return { engine, store, clock, storeErrors }
}

describe('a cache store that misbehaves', () => {
	it('never holds a read on a lookup that does not answer: it reads the source and says why', async () => {
		const base = memoryCacheStore()
		const store: CacheStore = { ...base, get: () => new Promise<CacheEntry | null>(() => {}) }
		const { engine, storeErrors } = setup({ store })
		const read = engine.read(
			vendor(async () => answer(7)),
			q
		)
		expect(await settlesWithin(read, 1_000)).toBe(true)
		expect((await read).totals).toEqual({ pageviews: 7 })
		expect(storeErrors).toContainEqual([
			'Error: analytics: the read cache did not answer within 200 ms',
			'get',
		])
	})

	it('answers before a write that never finishes, and stops waiting on it past the timeout', async () => {
		const base = memoryCacheStore()
		const store: CacheStore = { ...base, set: () => new Promise<void>(() => {}) }
		const { engine, storeErrors } = setup({ store })
		const read = engine.read(
			vendor(async () => answer(3)),
			q
		)
		expect(await settlesWithin(read, 100)).toBe(true)
		expect(await settlesWithin(engine.idle(), 1_000)).toBe(true)
		expect(storeErrors).toContainEqual([
			'Error: analytics: the read cache did not store within 200 ms',
			'set',
		])
	})

	it('reads an entry whose instants are not numbers as a miss and reports it, never throwing', async () => {
		const now = 10_000_000
		const garbage = {
			value: answer(5),
			fetchedAt: Number.NaN,
			expiresAt: now - 1,
			staleUntil: now + 60_000,
		}
		const store: CacheStore = { ...memoryCacheStore(), get: async () => garbage }
		const { engine, storeErrors } = setup({ store, now: () => now })
		const result = await engine.read(
			vendor(async () => answer(9)),
			q
		)
		expect(result.totals).toEqual({ pageviews: 9 })
		expect(storeErrors.map(([, operation]) => operation)).toContain('get')
	})
})

describe('a read past an expired entry (fresh=1)', () => {
	const busy = () => {
		const releases: Array<() => void> = []
		const query = vi.fn(
			(_q: AnalyticsQuery, _ctx: AdapterContext) =>
				new Promise<AnalyticsResult>((resolve) => {
					releases.push(() => resolve(answer(2)))
				})
		)
		return { adapter: vendor(query), query, releases }
	}

	it('takes its scope’s place for a cold read, waiting while the scope has none free', async () => {
		const { engine, clock } = setup({ coldReadsPerScope: 1, timeoutMs: 5_000 })
		const source = busy()
		const warm = engine.read(source.adapter, q)
		await vi.waitFor(() => expect(source.query).toHaveBeenCalledTimes(1))
		source.releases.shift()?.()
		await warm
		await engine.idle()
		clock.at = 61_000
		const other = engine.read(source.adapter, { ...q, path: '/other' })
		await vi.waitFor(() => expect(source.query).toHaveBeenCalledTimes(2))
		const fresh = engine.read(source.adapter, q, { allowStale: false })
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(source.query).toHaveBeenCalledTimes(2)
		source.releases.shift()?.()
		await other
		await vi.waitFor(() => expect(source.query).toHaveBeenCalledTimes(3))
		source.releases.shift()?.()
		expect((await fresh).meta.stale).toBeUndefined()
	})

	it('answers the expired entry, stale, when its scope has no place and the caller refuses to wait', async () => {
		const { engine, clock } = setup({ coldReadsPerScope: 1, timeoutMs: 5_000 })
		const source = busy()
		const warm = engine.read(source.adapter, q)
		await vi.waitFor(() => expect(source.query).toHaveBeenCalledTimes(1))
		source.releases.shift()?.()
		await warm
		await engine.idle()
		clock.at = 61_000
		const other = engine.read(source.adapter, { ...q, path: '/other' })
		await vi.waitFor(() => expect(source.query).toHaveBeenCalledTimes(2))
		const refused = await engine.read(source.adapter, q, {
			allowStale: false,
			whenBusy: 'refuse',
		})
		expect(refused.meta.stale).toBe(true)
		expect(source.query).toHaveBeenCalledTimes(2)
		source.releases.shift()?.()
		await other
	})
})

describe('a closed engine', () => {
	it('starts no refresh and writes nothing, and still answers', async () => {
		const { engine, store, clock } = setup()
		const query = vi.fn(async () => answer(4))
		const source = vendor(query)
		await engine.read(source, q)
		await engine.idle()
		const set = vi.spyOn(store, 'set')
		await engine.close()
		clock.at = 61_000
		expect((await engine.read(source, q)).meta.stale).toBe(true)
		expect(query).toHaveBeenCalledTimes(1)
		expect((await engine.read(source, { ...q, path: '/new' })).totals).toEqual({ pageviews: 4 })
		await engine.idle()
		expect(set).not.toHaveBeenCalled()
	})

	it('waits for work a caller handed it before it settles', async () => {
		const { engine } = setup()
		let finished = false
		engine.keep(
			new Promise<void>((resolve) =>
				setTimeout(() => {
					finished = true
					resolve()
				}, 20)
			)
		)
		await engine.close()
		expect(finished).toBe(true)
	})
})

describe('sources built anew on every read (providers.resolve)', () => {
	it('rests one tenant’s source after a refused key, never another tenant’s of the same id', async () => {
		const lanes = createLanes({ rebuilt: () => true })
		const { engine } = setup({ lanes })
		const refused = vendor(async () => {
			throw new ProviderHttpError(401, 'plausible', 'bad key')
		}, 'plausible')
		const failure = await engine.read(refused, q).then(
			() => null,
			(err: unknown) => classifyError(err)
		)
		expect(failure?.kind).toBe('source_misconfigured')
		expect(engine.health(refused, 't1').open).toBe(true)
		const healthy = vendor(async () => answer(6), 'plausible')
		expect((await engine.read(healthy, { ...q, scope: 't2' })).totals).toEqual({ pageviews: 6 })
		expect(engine.health(healthy, 't2').open).toBe(false)
	})
})

describe('cache keys while a configuration epoch cannot be read', () => {
	it('never serves one site’s numbers under another’s after a second outage', async () => {
		let clock = 0
		const fallback = createEpochFallback(() => clock)
		let probe: string | Error = new Error('db down')
		const configEpoch = async (scope?: string | null): Promise<string> =>
			probe instanceof Error ? fallback.failed(scope) : fallback.read(scope, probe)
		const store = memoryCacheStore({ now: () => clock })
		const engine = createEngine({
			store,
			ttl: { aggregate: 3600 },
			timeoutMs: 1_000,
			now: () => clock,
			configEpoch,
		})
		const site = (pageviews: number) => vendor(async () => answer(pageviews), 'plausible:doc1')
		expect((await engine.read(site(111), q)).totals).toEqual({ pageviews: 111 })
		probe = 'E2'
		clock += 20_000
		expect((await engine.read(site(222), q)).totals).toEqual({ pageviews: 222 })
		probe = new Error('db down again')
		clock += 20_000
		expect((await engine.read(site(222), q)).totals).toEqual({ pageviews: 222 })
		await engine.idle()
	})
})
