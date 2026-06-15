import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { ROLLUPS_SLUG } from '../../src/native/collections/rollups'
import { composeGeoResolvers } from '../../src/native/geo/composeGeoResolvers'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { maxmindResolver } from '../../src/native/geo/maxmindResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import { pruneEventsTask } from '../../src/native/retention/pruneTask'
import { kvCacheStore } from '../../src/surfacing/cacheStore'
import { createEngine } from '../../src/surfacing/engine'

const ingest = (booted: BootedPayload, path: string) =>
	makeIngestHandler(platformHeaderResolver)({
		payload: booted.payload,
		headers: new Headers({
			'content-type': 'application/json',
			'user-agent': 'UA',
			'x-vercel-ip-country': 'US',
		}),
		json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 500 }),
	} as never)

describeForDb('native ingest endpoint', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('ingests a pageview into events and rollups', async () => {
		const res = await ingest(booted, '/p')
		expect(res.status).toBe(202)
		const { totalDocs: events } = await booted.payload.count({ collection: EVENTS_SLUG as never })
		expect(events).toBe(1)
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG as never,
			where: { path: { equals: '/p' } },
			pagination: false,
		})
		expect((docs[0] as { pageviews: number; durationMs: number } | undefined)?.pageviews).toBe(1)
		expect((docs[0] as { pageviews: number; durationMs: number } | undefined)?.durationMs).toBe(500)
	})

	it('serves native pageviews through the surfacing engine', async () => {
		await ingest(booted, '/e2e')
		await ingest(booted, '/e2e')
		const engine = createEngine({
			store: kvCacheStore(booted.payload.kv),
			queue: { concurrency: 4 },
			ttl: { aggregate: 60, realtime: 5 },
		})
		const result = await engine.read(adapter, {
			path: '/e2e',
			metrics: ['pageviews', 'avgDuration'],
			dateRange: { start: new Date('2020-01-01'), end: new Date('2030-01-01') },
		})
		expect(result.totals?.pageviews).toBe(2)
		expect(result.totals?.avgDuration).toBe(500)
	})

	it('counts unique visitors and sessions across repeated ingests', async () => {
		await ingest(booted, '/u')
		await ingest(booted, '/u')
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG as never,
			where: { path: { equals: '/u' }, dimension: { equals: '' } },
			pagination: false,
		})
		const row = docs[0] as { pageviews: number; visitors: number; sessions: number } | undefined
		expect(row?.pageviews).toBe(2)
		expect(row?.visitors).toBe(1)
		expect(row?.sessions).toBe(1)
	})

	it('ingests with a missing MaxMind db, falling back to the platform-header country', async () => {
		const composed = composeGeoResolvers(
			platformHeaderResolver,
			maxmindResolver({ dbPath: '/nonexistent/GeoLite2-City.mmdb' })
		)
		const res = await makeIngestHandler(composed)({
			payload: booted.payload,
			headers: new Headers({
				'content-type': 'application/json',
				'user-agent': 'UA',
				'x-vercel-ip-country': 'US',
			}),
			json: async () => ({ type: 'pageview', path: '/geo', hostname: 'h' }),
		} as never)
		expect(res.status).toBe(202)
		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/geo' } },
			pagination: false,
		})
		expect((docs[0] as { country?: string } | undefined)?.country).toBe('US')
	})
})

describeForDb('native retention', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native({ retentionDays: 30 })] }),
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
	})

	it('prunes raw events older than the cutoff', async () => {
		await ingest(booted, '/old')
		const task = pruneEventsTask(0)
		const handler = task.handler as (args: {
			req: { payload: typeof booted.payload }
		}) => Promise<{ output: { deleted: number } }>
		const result = await handler({ req: { payload: booted.payload } })
		expect(result.output.deleted).toBeGreaterThan(0)
		const { totalDocs } = await booted.payload.count({ collection: EVENTS_SLUG as never })
		expect(totalDocs).toBe(0)
	})
})
