import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { composeGeoResolvers } from '../../src/native/geo/composeGeoResolvers'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { maxmindResolver } from '../../src/native/geo/maxmindResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import type { HitRow } from '../../src/native/store/types'
import { CACHE_SLUG } from '../../src/surfacing/cacheCollection'
import { collectionCacheStore } from '../../src/surfacing/collectionCacheStore'
import { createEngine } from '../../src/surfacing/engine'
import { INGEST_HOST, ingestRequest } from './ingestRequest'
import { aroundNow, countHits, nativeOf, storedHits } from './nativeHelpers'

const ingest = (booted: BootedPayload, path: string) =>
	makeIngestHandler({
		geoResolver: platformHeaderResolver,
		attribution: { trustedPlatform: 'vercel' },
		target: nativeOf,
	})(
		ingestRequest(
			booted.payload,
			{ type: 'pageview', path, hostname: 'h', durationMs: 500 },
			{ 'x-vercel-ip-country': 'US' }
		)
	)

describeForDb('native ingest endpoint', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		// Held still: the one visitor below hashes with its day's salt, so every test's hits must
		// land on one day however late the run reaches them.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it('stores a pageview as one raw hit, which the adapter reads back', async () => {
		const res = await ingest(booted, '/p')
		expect(res.status).toBe(202)
		expect(await countHits(booted.payload)).toBe(1)
		const [hit] = await storedHits(booted.payload, { path: { equals: '/p' } })
		expect(hit).toMatchObject({ type: 'pageview', hostname: 'h', durationMs: 500, country: 'US' })
		const read = await adapter.query(
			{ path: '/p', metrics: ['pageviews', 'avgDuration'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(read.totals).toEqual({ pageviews: 1, avgDuration: 500 })
	})

	it('serves native pageviews through the surfacing engine', async () => {
		await ingest(booted, '/e2e')
		await ingest(booted, '/e2e')
		const engine = createEngine({
			payload: booted.payload,
			store: collectionCacheStore(booted.payload, { slug: CACHE_SLUG }),
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 15_000,
		})
		const result = await engine.read(adapter, {
			path: '/e2e',
			metrics: ['pageviews', 'avgDuration'],
			dateRange: aroundNow(),
		})
		expect(result.totals?.pageviews).toBe(2)
		expect(result.totals?.avgDuration).toBe(500)
		await engine.idle()
	})

	it('counts unique visitors and visits across repeated ingests', async () => {
		await ingest(booted, '/u')
		await ingest(booted, '/u')
		const read = await adapter.query(
			{ path: '/u', metrics: ['pageviews', 'visitors', 'sessions'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(read.totals).toEqual({ pageviews: 2, visitors: 1, sessions: 1 })
	})

	it('persists browser, os, language and the utm keys, and never the raw query', async () => {
		const res = await makeIngestHandler({ geoResolver: platformHeaderResolver, target: nativeOf })(
			ingestRequest(
				booted.payload,
				{
					type: 'pageview',
					path: '/dimensions',
					hostname: 'h',
					query:
						'utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=shoes&token=secret',
				},
				{
					'user-agent':
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
					'accept-language': 'de-DE,de;q=0.9',
				}
			)
		)
		expect(res.status).toBe(202)
		const docs = await storedHits(booted.payload, { path: { equals: '/dimensions' } })
		expect(docs[0]).toMatchObject({
			browser: 'chrome',
			os: 'macos',
			language: 'de-de',
			utmSource: 'newsletter',
			utmMedium: 'email',
			utmCampaign: 'spring',
			utmContent: 'hero',
			utmTerm: 'shoes',
		})
		expect(JSON.stringify(docs[0])).not.toContain('secret')
	})

	it('ingests with a missing MaxMind db, falling back to the platform-header country', async () => {
		const composed = composeGeoResolvers(
			platformHeaderResolver,
			maxmindResolver({ dbPath: '/nonexistent/GeoLite2-City.mmdb' })
		)
		const res = await makeIngestHandler({
			geoResolver: composed,
			attribution: { trustedPlatform: 'vercel' },
			target: nativeOf,
		})(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path: '/geo', hostname: 'h' },
				{ 'x-vercel-ip-country': 'US' }
			)
		)
		expect(res.status).toBe(202)
		const docs = await storedHits(booted.payload, { path: { equals: '/geo' } })
		expect(docs[0]?.country).toBe('US')
	})

	// Every distinct stored hostname opens a family of daily totals that is kept, so the spellings
	// of one host have to land in one family and junk has to land in none.
	it('lands every spelling of one host under one hostname', async () => {
		const handler = makeIngestHandler({ geoResolver: platformHeaderResolver, target: nativeOf })
		const spellings = ['Site.Example', 'site.example:3000', 'site.example.', 'SITE.EXAMPLE..:443']
		const junk = ['site..example', '.site.example', 'site example', `${'a'.repeat(300)}.example`]
		for (const host of [...spellings, ...junk]) {
			const res = await handler(
				ingestRequest(booted.payload, { type: 'pageview', path: '/spelling' }, { host })
			)
			expect(res.status, host).toBe(202)
		}

		const docs = await storedHits(booted.payload, { path: { equals: '/spelling' } })
		expect(docs).toHaveLength(spellings.length)
		expect([...new Set(docs.map((doc) => doc.hostname))]).toEqual(['site.example'])
		const read = await adapter.query(
			{
				path: '/spelling',
				hostname: 'site.example',
				metrics: ['pageviews'],
				dateRange: aroundNow(),
			},
			{ payload: booted.payload }
		)
		expect(read.totals?.pageviews).toBe(spellings.length)
	})

	it('serves a site-wide country breakdown through the native adapter', async () => {
		await ingest(booted, '/country-a')
		await ingest(booted, '/country-b')
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				dimensions: ['country'],
				dateRange: aroundNow(),
			},
			{ payload: booted.payload }
		)
		const us = result.rows.find((r) => r.dimensions?.country === 'US')
		expect(us?.metrics.pageviews).toBeGreaterThanOrEqual(2)
		// Every request in this suite comes from one visitor, so the US row holds exactly one
		// visitor however many pages were hit.
		expect(us?.metrics.visitors).toBe(1)
	})
})

// The ingest endpoint is public and unauthenticated, so its input guards are asserted
// through the real router rather than against the handler in isolation.
describeForDb('native ingest through the router', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const post = (body: BodyInit, contentType = 'application/json') =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://localhost:3000/api/_x/e', {
				method: 'POST',
				body,
				headers: { 'content-type': contentType, 'user-agent': 'UA', host: INGEST_HOST },
			}),
		})

	it('400s a garbage body instead of throwing a 500', async () => {
		for (const body of ['<html>nope</html>', '', '"pageview"', '[]']) {
			const res = await post(body)
			expect(res.status).toBe(400)
		}
	})

	it('413s a body over the ingest cap', async () => {
		const res = await post(
			JSON.stringify({
				type: 'pageview',
				path: '/big',
				hostname: 'h',
				props: { note: 'x'.repeat(70_000) },
			})
		)
		expect(res.status).toBe(413)
		expect(await countHits(booted.payload, { path: { equals: '/big' } })).toBe(0)
	})

	it('still ingests a valid event', async () => {
		const res = await post(
			JSON.stringify({ type: 'pageview', path: '/routed', hostname: 'h', durationMs: 300 })
		)
		expect(res.status).toBe(202)
		const docs = await storedHits(booted.payload, { path: { equals: '/routed' } })
		expect(docs).toHaveLength(1)
		expect(docs[0]?.durationMs).toBe(300)
	})

	// One visitor's pageview and goal arriving together share nothing a write has to wait for:
	// each is one row of its own.
	it('202s a pageview and a goal from one visitor arriving at once, and stores both', async () => {
		const body = (type: 'pageview' | 'goal') =>
			JSON.stringify({
				type,
				path: '/race',
				hostname: 'h',
				...(type === 'goal' ? { name: 'race-goal' } : {}),
			})
		for (let round = 0; round < 20; round++) {
			const statuses = (await Promise.all([post(body('pageview')), post(body('goal'))])).map(
				(res) => res.status
			)
			expect(statuses, `round ${round}`).toEqual([202, 202])
		}
		expect(await countHits(booted.payload, { path: { equals: '/race' } })).toBe(40)
	})
})

describeForDb('native write buffer', {}, (db) => {
	const adapter = native({ buffer: { maxSize: 10, maxAgeMs: 60_000 } })
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	const ingestBuffered = async (path: string): Promise<void> => {
		const ep = booted.payload.config.endpoints?.find((e) => e.path === '/_x/e')
		if (!ep) {
			throw new Error('ingest endpoint not registered')
		}
		await ep.handler(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
				{ 'x-vercel-ip-country': 'US' }
			)
		)
	}

	it('holds ingests until flushed, then writes them in one batch', async () => {
		const append = vi.spyOn(nativeOf(booted.payload).store, 'append')
		try {
			await ingestBuffered('/buf')
			await ingestBuffered('/buf')
			expect(await countHits(booted.payload, { path: { equals: '/buf' } })).toBe(0)

			await adapter.flush(booted.payload)

			expect(append).toHaveBeenCalledTimes(1)
			expect(append.mock.calls[0]?.[0]).toHaveLength(2)
			const read = await adapter.query(
				{ path: '/buf', metrics: ['pageviews', 'visitors', 'sessions'], dateRange: aroundNow() },
				{ payload: booted.payload }
			)
			expect(read.totals).toEqual({ pageviews: 2, visitors: 1, sessions: 1 })
		} finally {
			append.mockRestore()
		}
	})

	it('stores the rows of a batch that land when the database refused one of them for its values', async () => {
		const { store } = nativeOf(booted.payload)
		const append = store.append.bind(store)
		const refusing = vi
			.spyOn(store, 'append')
			.mockImplementation(async (hits: readonly HitRow[]) => {
				if (hits.some((hit) => hit.path === '/batch-refused')) {
					// What a driver raises for a row's own values: Postgres' value-too-long class.
					throw Object.assign(new Error('value too long for type character varying'), {
						code: '22001',
					})
				}
				return append(hits)
			})
		const error = vi.spyOn(booted.payload.logger, 'error').mockImplementation(() => undefined)
		try {
			for (const path of ['/batch-a', '/batch-refused', '/batch-b']) {
				await ingestBuffered(path)
			}
			await adapter.flush(booted.payload)
			for (const path of ['/batch-a', '/batch-b']) {
				expect(await countHits(booted.payload, { path: { equals: path } }), path).toBe(1)
			}
			expect(await countHits(booted.payload, { path: { equals: '/batch-refused' } })).toBe(0)
			expect(error).toHaveBeenCalledTimes(1)
		} finally {
			refusing.mockRestore()
			error.mockRestore()
		}
	})

	it('writes a batch the database refused for a lock again whole, once, rather than row by row', async () => {
		const { store } = nativeOf(booted.payload)
		const append = store.append.bind(store)
		let locked = 1
		const calls: number[] = []
		const busy = vi.spyOn(store, 'append').mockImplementation(async (hits: readonly HitRow[]) => {
			calls.push(hits.length)
			if (locked-- > 0) {
				throw Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' })
			}
			return append(hits)
		})
		try {
			for (const path of ['/locked-a', '/locked-b', '/locked-c']) {
				await ingestBuffered(path)
			}
			await adapter.flush(booted.payload)
			expect(calls).toEqual([3, 3])
			for (const path of ['/locked-a', '/locked-b', '/locked-c']) {
				expect(await countHits(booted.payload, { path: { equals: path } }), path).toBe(1)
			}
		} finally {
			busy.mockRestore()
		}
	})
})
