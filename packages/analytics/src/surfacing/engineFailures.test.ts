import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import type { Ga4Sdk } from '../core/sdks'
import { HostRefusedError } from '../core/sourceErrors'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import type { ReadOrigin } from './afterRead'
import { BREAKER_BASE_MS } from './breaker'
import { classifyError, ReadFailedError } from './classifyError'
import { createEngine, type EngineOptions } from './engine'

const q: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

/** Past the 60 s TTL the setups use, and past the 15 s memo. */
const EXPIRED_AT = 61_000

const answer = (pageviews = 1): AnalyticsResult => ({
	rows: [],
	totals: { pageviews },
	meta: { provider: 'vendor', fetchedAt: '2026-01-31T00:00:00.000Z' },
})

const vendor = (
	query: AnalyticsAdapter['query'],
	capabilities: Partial<AnalyticsCapabilities> = {}
): AnalyticsAdapter => ({
	id: 'vendor',
	label: 'Vendor',
	capabilities: { ...memoryAdapter().capabilities, ...capabilities },
	isConfigured: () => true,
	query,
})

const setup = (extra: Partial<EngineOptions> = {}) => {
	const clock = { at: 0 }
	const now = () => clock.at
	const store = memoryCacheStore({ now })
	const engine = createEngine({
		store,
		ttl: { aggregate: 60, realtime: 5 },
		timeoutMs: 15_000,
		now,
		...extra,
	})
	return { engine, store, clock }
}

/** What a read rejected with, classified; throws when it answered instead. */
const failureOf = async (read: Promise<AnalyticsResult>) => {
	const err: unknown = await read.then(
		() => {
			throw new Error('expected the read to fail')
		},
		(caught: unknown) => caught
	)
	expect(err).toBeInstanceOf(ReadFailedError)
	return classifyError(err)
}

/** An adapter whose next answers the test decides. */
const scripted = (capabilities: Partial<AnalyticsCapabilities> = {}) => {
	let next: () => Promise<AnalyticsResult> = async () => answer()
	const query = vi.fn((_q: AnalyticsQuery, _ctx: AdapterContext) => next())
	return {
		adapter: vendor(query, capabilities),
		query,
		answerWith: (fn: () => Promise<AnalyticsResult>) => {
			next = fn
		},
	}
}

afterEach(() => {
	vi.useRealTimers()
})

describe('createEngine failures', () => {
	it("serves the saved numbers of a source whose key was refused, saying the source's settings need a look", async () => {
		const { engine, clock } = setup()
		const source = scripted()
		await engine.read(source.adapter, q)
		clock.at = EXPIRED_AT
		source.answerWith(async () => {
			throw new ProviderHttpError(401, 'vendor', 'bad key')
		})
		const first = await engine.read(source.adapter, q)
		expect(first.meta).toMatchObject({ stale: true })
		expect(first.meta.sourceError).toBeUndefined()
		await engine.idle()
		const second = await engine.read(source.adapter, q)
		expect(second.meta).toMatchObject({ stale: true, sourceError: 'misconfigured' })
		expect(second.totals?.pageviews).toBe(1)
	})

	it('names a refused host on the stale answer', async () => {
		const { engine, clock } = setup()
		const source = scripted()
		await engine.read(source.adapter, q)
		clock.at = EXPIRED_AT
		source.answerWith(async () => {
			throw new HostRefusedError('https://stats.internal', 'it resolves to a private address')
		})
		await engine.read(source.adapter, q)
		await engine.idle()
		expect((await engine.read(source.adapter, q)).meta.sourceError).toBe('host-refused')
	})

	it('never serves saved numbers for a query the source refuses as asked', async () => {
		const { engine, clock } = setup()
		const source = scripted()
		await engine.read(source.adapter, q)
		clock.at = EXPIRED_AT
		source.answerWith(async () => {
			throw new ProviderHttpError(400, 'vendor', 'bad regex')
		})
		// The first read finds no failure yet and answers at once; its refresh learns the refusal.
		expect((await engine.read(source.adapter, q)).meta.stale).toBe(true)
		await engine.idle()
		expect(await failureOf(engine.read(source.adapter, q))).toMatchObject({ kind: 'invalid_param' })
		expect(await failureOf(engine.read(source.adapter, q, { allowStale: false }))).toMatchObject({
			kind: 'invalid_param',
		})
	})

	it('answers a cold read at once while the breaker is open, as the refusal that opened it', async () => {
		const { engine } = setup()
		const source = scripted()
		source.answerWith(async () => {
			throw new ProviderHttpError(403, 'vendor', 'no access to this property')
		})
		expect(await failureOf(engine.read(source.adapter, q))).toEqual({
			kind: 'source_misconfigured',
		})
		expect(engine.health(source.adapter)).toMatchObject({
			open: true,
			lastFailure: 'source_misconfigured',
		})
		const refused = await failureOf(engine.read(source.adapter, { ...q, path: '/other' }))
		expect(refused.kind).toBe('source_misconfigured')
		expect(refused.retryAfterMs).toBeGreaterThan(BREAKER_BASE_MS - 1000)
		expect(source.query).toHaveBeenCalledTimes(1)
	})

	it('answers a cold read at once as unavailable while outages keep the breaker open', async () => {
		vi.useFakeTimers()
		const { engine } = setup()
		const source = scripted()
		source.answerWith(async () => {
			throw new ProviderHttpError(502, 'vendor', 'bad gateway')
		})
		const first = failureOf(engine.read(source.adapter, q))
		await vi.advanceTimersByTimeAsync(2000)
		await first
		const second = failureOf(engine.read(source.adapter, { ...q, path: '/b' }))
		await vi.advanceTimersByTimeAsync(2000)
		await second
		const calls = source.query.mock.calls.length
		const refused = await failureOf(engine.read(source.adapter, { ...q, path: '/c' }))
		expect(refused).toMatchObject({ kind: 'unavailable' })
		expect(refused.retryAfterMs).toBeGreaterThan(0)
		expect(source.query).toHaveBeenCalledTimes(calls)
	})

	it("skips an expired entry's refresh while the breaker is open, and still answers it", async () => {
		const { engine, clock } = setup()
		const source = scripted()
		await engine.read(source.adapter, q)
		await engine.read(source.adapter, { ...q, path: '/other' })
		source.answerWith(async () => {
			throw new ProviderHttpError(401, 'vendor', 'revoked')
		})
		clock.at = EXPIRED_AT
		await engine.read(source.adapter, q)
		await engine.idle()
		expect(source.query).toHaveBeenCalledTimes(3)
		const stale = await engine.read(source.adapter, { ...q, path: '/other' })
		await engine.idle()
		expect(stale.meta).toMatchObject({ stale: true, sourceError: 'misconfigured' })
		expect(source.query).toHaveBeenCalledTimes(3)
	})

	it('tells a cold read how long the vendor asked to wait when the pause outlasts the read', async () => {
		vi.useFakeTimers()
		const { engine } = setup({ timeoutMs: 1000 })
		const source = scripted()
		source.answerWith(async () => {
			throw new ProviderHttpError(503, 'vendor', { message: 'maintenance', retryAfterMs: 4000 })
		})
		const read = failureOf(engine.read(source.adapter, q))
		await vi.advanceTimersByTimeAsync(600)
		const failure = await read
		expect(failure.kind).toBe('unavailable')
		expect(failure.retryAfterMs).toBeGreaterThan(3000)
		expect(failure.retryAfterMs).toBeLessThanOrEqual(4000)
		// The pause refused the retry before it was sent.
		expect(source.query).toHaveBeenCalledTimes(1)
	})

	it('hands the adapter the time its read has left', async () => {
		const { engine } = setup({ timeoutMs: 9000 })
		let left: number | undefined
		await engine.read(
			vendor(async (_query, ctx) => {
				left = ctx.remainingMs?.()
				return answer()
			}),
			q
		)
		expect(left).toBeGreaterThan(8000)
		expect(left).toBeLessThanOrEqual(9000)
	})
})

describe('createEngine upstream accounting', () => {
	class FakeClient {
		runReport = vi.fn(async () => [
			{ rows: [{ dimensionValues: [], metricValues: [{ value: '5' }] }], metadata: {} },
		])
	}
	const ga4Source = (): AnalyticsAdapter => {
		const adapter = ga4({
			propertyId: '1',
			credentials: { client_email: 'sa@x.test', private_key: 'pk' },
			sdk: { BetaAnalyticsDataClient: FakeClient } as unknown as Ga4Sdk,
		})
		return {
			...adapter,
			capabilities: {
				...adapter.capabilities,
				rateLimit: { requestsPerMinute: 2, maxConcurrent: 10 },
			},
		}
	}

	it('spends two tokens on a GA4 read paired with its goal report', async () => {
		vi.useFakeTimers()
		const { engine } = setup({ timeoutMs: 60_000 })
		const source = ga4Source()
		await engine.read(source, {
			...q,
			metrics: ['pageviews', 'conversions'],
			goalSlugs: ['signup'],
		})
		let done = false
		const next = engine.read(source, { ...q, path: '/next' }).then((result) => {
			done = true
			return result
		})
		await vi.advanceTimersByTimeAsync(29_999)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect((await next).totals?.pageviews).toBe(5)
	})

	it('counts a read of an adapter that is not upstream aware as one request', async () => {
		vi.useFakeTimers()
		const { engine } = setup({ timeoutMs: 60_000 })
		let calls = 0
		const source = vendor(
			async (_query, ctx) => {
				calls++
				// Inside a counted read, upstream passes straight through rather than queueing again.
				return (await ctx.upstream?.(async () => answer())) ?? answer()
			},
			{ rateLimit: { requestsPerMinute: 2 } }
		)
		await engine.read(source, q)
		await engine.read(source, { ...q, path: '/b' })
		expect(calls).toBe(2)
		let done = false
		void engine.read(source, { ...q, path: '/c' }).then(() => {
			done = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(done).toBe(false)
		await vi.advanceTimersByTimeAsync(30_000)
		expect(done).toBe(true)
	})
})

describe('createEngine shaping and hooks', () => {
	it('ranks and cuts a breakdown a vendor sent whole before caching it', async () => {
		const { engine, store } = setup()
		const rows = ['/a', '/b', '/c', '/d'].map((page, index) => ({
			dimensions: { page },
			metrics: { pageviews: index },
		}))
		const source = vendor(async () => ({ ...answer(), rows }))
		const result = await engine.read(source, {
			...q,
			dimensions: ['page'],
			limit: 2,
			order: { metric: 'pageviews', direction: 'desc' },
		})
		expect(result.rows.map((row) => row.dimensions?.page)).toEqual(['/d', '/c'])
		expect([...store.entries.values()][0]?.value.rows).toHaveLength(2)
	})

	it('answers through afterRead and never caches what it returns', async () => {
		const seen: ReadOrigin[] = []
		const payload = {} as Payload
		const { engine, store, clock } = setup({
			payload,
			afterRead: (args) => {
				seen.push(args.from)
				expect(args.adapterId).toBe('vendor')
				expect(args.query.path).toBe('/pricing')
				expect(args.payload).toBe(payload)
				const { result } = args
				return { ...result, totals: { pageviews: (result.totals?.pageviews ?? 0) * 10 } }
			},
		})
		const source = scripted()
		expect((await engine.read(source.adapter, q)).totals?.pageviews).toBe(10)
		expect([...store.entries.values()][0]?.value.totals?.pageviews).toBe(1)
		expect((await engine.read(source.adapter, q)).totals?.pageviews).toBe(10)
		clock.at = 20_000
		await engine.read(source.adapter, q)
		clock.at = EXPIRED_AT
		await engine.read(source.adapter, q)
		await engine.idle()
		expect(seen).toEqual(['source', 'memory', 'store', 'stale'])
	})

	it('answers as if a throwing hook returned nothing, and tells its owner', async () => {
		const onHookError = vi.fn()
		const failure = new Error('metrics backend down')
		const { engine } = setup({
			payload: {} as Payload,
			afterRead: () => {
				throw failure
			},
			onHookError,
		})
		expect((await engine.read(scripted().adapter, q)).totals?.pageviews).toBe(1)
		expect(onHookError).toHaveBeenCalledWith(failure)
	})

	it('keeps an observing hook’s answer, and skips the hook for a read that keeps what it reads', async () => {
		const observed: number[] = []
		const { engine } = setup({
			payload: {} as Payload,
			afterRead: ({ durationMs }) => {
				observed.push(durationMs)
			},
		})
		const source = scripted()
		expect((await engine.read(source.adapter, q)).totals?.pageviews).toBe(1)
		expect(observed).toHaveLength(1)
		await engine.read(source.adapter, q, { afterRead: false })
		expect(observed).toHaveLength(1)
	})

	it('keeps every cache write and background refresh alive past the response through keepAlive', async () => {
		const keepAlive = vi.fn()
		const { engine, clock } = setup({ keepAlive })
		const source = scripted()
		await engine.read(source.adapter, q)
		expect(keepAlive).toHaveBeenCalledTimes(1)
		clock.at = EXPIRED_AT
		await engine.read(source.adapter, q)
		expect(keepAlive).toHaveBeenCalledTimes(2)
		expect(keepAlive.mock.calls[1]?.[0]).toBeInstanceOf(Promise)
		await engine.idle()
		expect(keepAlive).toHaveBeenCalledTimes(3)
	})

	it('settles an asynchronous keepAlive that rejects without failing the read', async () => {
		const keepAlive = vi.fn(async () => {
			throw new Error('after() outside a request')
		})
		const { engine } = setup({ keepAlive })
		expect((await engine.read(scripted().adapter, q)).totals?.pageviews).toBe(1)
		await engine.idle()
		expect(keepAlive).toHaveBeenCalledTimes(1)
	})
})

describe('createEngine cold-read budget', () => {
	it('refuses a cold read past its scope budget when asked to, queues one otherwise, and leaves other scopes alone', async () => {
		const { engine } = setup({ coldReadsPerScope: 1 })
		const releases: Array<() => void> = []
		const query = vi.fn(
			(_q: AnalyticsQuery) =>
				new Promise<AnalyticsResult>((resolve) => {
					releases.push(() => resolve(answer()))
				})
		)
		const source = vendor(query)
		const alpha = { ...q, scope: 'alpha' }
		const first = engine.read(source, alpha)
		await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1))

		expect(
			await failureOf(engine.read(source, { ...alpha, path: '/b' }, { whenBusy: 'refuse' }))
		).toEqual({ kind: 'rate_limited', retryAfterMs: 2000 })
		// The same read as the one waiting joins it rather than being refused.
		const joined = engine.read(source, alpha, { whenBusy: 'refuse' })
		const queued = engine.read(source, { ...alpha, path: '/c' })
		const beta = engine.read(source, { ...q, scope: 'beta' }, { whenBusy: 'refuse' })
		await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2))
		expect(query.mock.calls[1]?.[0].scope).toBe('beta')

		releases[0]?.()
		await Promise.all([first, joined])
		await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3))
		expect(query.mock.calls[2]?.[0].path).toBe('/c')
		releases[1]?.()
		releases[2]?.()
		await Promise.all([queued, beta])
	})
})
