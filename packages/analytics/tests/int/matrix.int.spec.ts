import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { ROLLUPS_SLUG, rollupsCollection } from '../../src/native/collections/rollups'
import { SEEN_SLUG, seenCollection } from '../../src/native/collections/seen'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { applyDistinctDeltas } from '../../src/native/rollups/applyDistinctDeltas'
import { applyRollupDeltas } from '../../src/native/rollups/applyRollupDeltas'
import { bumpRollup } from '../../src/native/rollups/bumpRollup'
import { computeRollupDeltas } from '../../src/native/rollups/deltas'
import { insertIfNew } from '../../src/native/rollups/insertIfNew'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [memoryAdapter()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})
})

const rollupsOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), rollupsCollection()]
	return config
}

const seenOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), seenCollection()]
	return config
}

describeForDb('native rollup atomic apply', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: rollupsOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`upserts then atomically increments the same bucket on ${db}`, async () => {
		const key = {
			granularity: 'day' as const,
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
			dimension: '',
			dimvalue: '',
		}
		const delta = { key, inc: { pageviews: 1, events: 0, durationMs: 100, samples: 1 } }
		await applyRollupDeltas(booted.payload, [delta])
		await applyRollupDeltas(booted.payload, [delta])
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/p' } },
			pagination: false,
		})
		expect(docs).toHaveLength(1)
		expect(docs[0]?.pageviews).toBe(2)
		expect(docs[0]?.durationMs).toBe(200)
		expect(docs[0]?.samples).toBe(2)
	})
})

describeForDb('native bumpRollup baseline', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: rollupsOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`initializes the full metric baseline when a partial bump creates the row on ${db}`, async () => {
		const key = {
			granularity: 'day' as const,
			period: new Date('2026-03-01T00:00:00Z'),
			path: '/baseline',
			dimension: '',
			dimvalue: '',
		}
		await bumpRollup(booted.payload, key, { visitors: 1 })
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/baseline' } },
			pagination: false,
		})
		const row = docs[0] as { visitors: number; sessions: number; pageviews: number } | undefined
		expect(row?.visitors).toBe(1)
		expect(row?.sessions).toBe(0)
		expect(row?.pageviews).toBe(0)
	})
})

describeForDb('native insertIfNew dedup', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: seenOnly, db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	it(`returns true once then false for the same key on ${db}`, async () => {
		const key = {
			bucket: 'b1',
			kind: 'visitor',
			value: 'v1',
			period: new Date('2026-01-10T00:00:00Z'),
		}
		expect(await insertIfNew(booted.payload, SEEN_SLUG, key)).toBe(true)
		expect(await insertIfNew(booted.payload, SEEN_SLUG, key)).toBe(false)
	})

	it(`treats distinct values as new and a repeat as seen on ${db}`, async () => {
		const period = new Date('2026-01-10T00:00:00Z')
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vA',
				period,
			})
		).toBe(true)
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vB',
				period,
			})
		).toBe(true)
		expect(
			await insertIfNew(booted.payload, SEEN_SLUG, {
				bucket: 'b2',
				kind: 'visitor',
				value: 'vA',
				period,
			})
		).toBe(false)
	})
})

describeForDb('native distinct counting', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	const hit = async (visitorHash: string, country?: string): Promise<void> => {
		const event: StoredEvent = {
			timestamp: new Date('2026-02-01T10:00:00Z'),
			type: 'pageview',
			path: '/d',
			hostname: 'h',
			visitorHash,
			sessionId: `sess-${visitorHash}`,
			country,
			durationMs: 100,
		}
		const deltas = computeRollupDeltas(event)
		await applyRollupDeltas(booted.payload, deltas)
		await applyDistinctDeltas(booted.payload, event, deltas)
	}

	it(`counts a repeat visitor once but pageviews twice on ${db}`, async () => {
		await hit('vv1')
		await hit('vv1')
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/d' }, dimension: { equals: '' } },
			pagination: false,
		})
		const row = docs[0] as { pageviews: number; visitors: number; sessions: number } | undefined
		expect(row?.pageviews).toBe(2)
		expect(row?.visitors).toBe(1)
		expect(row?.sessions).toBe(1)
	})

	it(`counts two distinct visitors as two on ${db}`, async () => {
		await hit('vv2')
		await hit('vv3')
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/d' }, dimension: { equals: '' } },
			pagination: false,
		})
		const row = docs[0] as { visitors: number } | undefined
		// vv1 (prior test) + vv2 + vv3 all share the '/d' path bucket: 3 distinct visitors.
		expect(row?.visitors).toBe(3)
	})
})

describeForDb('native flushBatch coalescing', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	const event = (visitorHash: string, path: string): StoredEvent => ({
		timestamp: new Date('2026-04-01T10:00:00Z'),
		type: 'pageview',
		path,
		hostname: 'h',
		visitorHash,
		sessionId: `sess-${visitorHash}`,
		durationMs: 100,
	})

	it(`coalesces a batch into correct per-page rollups on ${db}`, async () => {
		await flushBatch(booted.payload, [event('v1', '/x'), event('v1', '/x'), event('v2', '/x')])
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/x' }, dimension: { equals: '' } },
			pagination: false,
		})
		const row = docs[0] as { pageviews: number; visitors: number; sessions: number } | undefined
		expect(row?.pageviews).toBe(3)
		expect(row?.visitors).toBe(2)
		expect(row?.sessions).toBe(2)
	})

	it(`matches the per-event path across flushes on ${db}`, async () => {
		await flushBatch(booted.payload, [event('v3', '/y')])
		await flushBatch(booted.payload, [event('v3', '/y')])
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/y' }, dimension: { equals: '' } },
			pagination: false,
		})
		const row = docs[0] as { pageviews: number; visitors: number } | undefined
		expect(row?.pageviews).toBe(2)
		expect(row?.visitors).toBe(1)
	})
})

describeForDb('analytics per-document read', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = (path: string) =>
		makeIngestHandler(platformHeaderResolver)({
			payload: booted.payload,
			headers: new Headers({
				'content-type': 'application/json',
				'user-agent': 'UA',
				'x-vercel-ip-country': 'US',
			}),
			json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 200 }),
		} as never)

	it(`reads per-document totals through the engine on ${db}`, async () => {
		await ingest('/matrix-doc')
		await ingest('/matrix-doc')
		const result = await readForField({
			req: { payload: booted.payload, locale: undefined } as unknown as PayloadRequest,
			collectionSlug: 'pages',
			data: { slug: '/matrix-doc' },
			metrics: ['pageviews', 'visitors'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.metrics.visitors).toBe(1)
	})
})
