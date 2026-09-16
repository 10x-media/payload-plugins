import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config, Endpoint, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DimensionKey } from '../../src/core/contract'
import { readForField } from '../../src/fields/readForDocument'
import { GOALS_SLUG } from '../../src/goals/collection'
import { GOAL_ACTION_TYPE } from '../../src/goals/trackGoalAction'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { ROLLUPS_SLUG, rollupsCollection } from '../../src/native/collections/rollups'
import { SEEN_SLUG, seenCollection } from '../../src/native/collections/seen'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { applyRollupDeltas } from '../../src/native/rollups/applyRollupDeltas'
import { bucketKey } from '../../src/native/rollups/bucketKey'
import { bumpRollup } from '../../src/native/rollups/bumpRollup'
import { bumpRollups } from '../../src/native/rollups/bumpRollups'
import { computeRollupDeltas, type RollupInc } from '../../src/native/rollups/deltas'
import { insertIfNew } from '../../src/native/rollups/insertIfNew'
import { insertManyIfNew } from '../../src/native/rollups/insertManyIfNew'
import { MAX_GEO_LENGTH } from '../../src/query/limits'
import { SYNC_TASK_SLUG, syncTask } from '../../src/sync/syncTask'
import { type MemoryAnalyticsAdapter, memoryAdapter } from '../../src/testing/memoryAdapter'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { resolveCustomRange } from '../../src/widgets/range'
import { readForWidget } from '../../src/widgets/readForWidget'
import { ACTION_HOST_SLUG, actionHost } from './actionHost'
import { ingestRequest } from './ingestRequest'

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

const actionGoals: Goal[] = [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }]

const rollupInc = (over: Partial<RollupInc> = {}): RollupInc => ({
	pageviews: 0,
	events: 0,
	durationMs: 0,
	samples: 0,
	conversions: 0,
	revenue: 0,
	scrollDepthSum: 0,
	scrollSamples: 0,
	...over,
})

const rollupsOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), rollupsCollection()]
	return config
}

const seenOnly = (config: Config): Config => {
	config.collections = [...(config.collections ?? []), seenCollection()]
	return config
}

/**
 * Inserts one rollup row via the raw DB driver (mirroring `bumpRollup`'s access pattern),
 * bypassing Payload's field validation so a genuine duplicate hits the storage-level unique
 * index rather than the app-level `required` check on the '' sentinel dimension/hostname
 * fields.
 */
const rawInsertRollup = async (payload: Payload, row: Record<string, unknown>): Promise<void> => {
	if (payload.db.name === 'mongoose') {
		const db = payload.db as unknown as {
			collections: Record<string, { collection: { insertOne: (doc: object) => Promise<unknown> } }>
		}
		await db.collections[ROLLUPS_SLUG]?.collection.insertOne(row)
		return
	}
	const db = payload.db as unknown as {
		drizzle: { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> } }
		tables: Record<string, Record<string, unknown>>
		tableNameMap: Map<string, string>
	}
	const tableName = db.tableNameMap.get('analytics_rollups')
	const table = tableName ? db.tables[tableName] : undefined
	if (!table) {
		throw new Error('analytics: drizzle table "analytics_rollups" not found')
	}
	await db.drizzle.insert(table).values(row)
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
			hostname: '',
		}
		const delta = { key, inc: rollupInc({ pageviews: 1, durationMs: 100, samples: 1 }) }
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
			hostname: '',
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

	// A pageview and a goal event arriving together race on one ledger row. The loser can come
	// back as a driver duplicate-key error rather than a quiet no-op, which used to escape the
	// ingest handler as a 500; enough concurrent writers reaches that branch on either adapter.
	it(`answers "already seen" to every writer that loses a crowded race on ${db}`, async () => {
		const key = {
			bucket: 'crowded',
			kind: 'visitor',
			value: 'v',
			period: new Date('2026-01-10T00:00:00Z'),
		}
		const results = await Promise.all(
			Array.from({ length: 24 }, () => insertIfNew(booted.payload, SEEN_SLUG, key))
		)
		expect(results.filter(Boolean)).toHaveLength(1)
	})
})

describeForDb('native batched ledger primitives', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	const period = new Date('2026-08-01T00:00:00Z')
	const seenRow = (value: string, bucket = 'batch') => ({ bucket, kind: 'visitor', value, period })

	it(`answers new or seen per row, in order, on ${db}`, async () => {
		expect(await insertManyIfNew(booted.payload, SEEN_SLUG, [seenRow('a'), seenRow('b')])).toEqual([
			true,
			true,
		])
		expect(
			await insertManyIfNew(booted.payload, SEEN_SLUG, [seenRow('b'), seenRow('c'), seenRow('a')])
		).toEqual([false, true, false])
	})

	it(`counts a row repeated inside one call once on ${db}`, async () => {
		expect(
			await insertManyIfNew(booted.payload, SEEN_SLUG, [seenRow('d'), seenRow('d'), seenRow('e')])
		).toEqual([true, false, true])
		const { totalDocs } = await booted.payload.count({
			collection: SEEN_SLUG,
			where: { value: { equals: 'd' } },
		})
		expect(totalDocs).toBe(1)
	})

	it(`takes an empty batch as a no-op on ${db}`, async () => {
		expect(await insertManyIfNew(booted.payload, SEEN_SLUG, [])).toEqual([])
		await expect(bumpRollups(booted.payload, [])).resolves.toBeUndefined()
	})

	const bucket = (dimvalue: string) => ({
		granularity: 'day' as const,
		period,
		path: '',
		dimension: 'country',
		dimvalue,
		hostname: '',
	})

	it(`upserts several buckets in one call, then increments them again on ${db}`, async () => {
		await bumpRollups(booted.payload, [
			{ key: bucket('US'), inc: { pageviews: 2, samples: 2 } },
			{ key: bucket('DE'), inc: { pageviews: 1, samples: 1 } },
		])
		await bumpRollups(booted.payload, [
			{ key: bucket('US'), inc: { pageviews: 1, visitors: 1 } },
			// Two entries for one bucket in a single call must sum rather than collide: on
			// Postgres a repeated conflict target in one statement is an error, not an upsert.
			{ key: bucket('DE'), inc: { visitors: 1 } },
			{ key: bucket('DE'), inc: { sessions: 1 } },
		])
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { dimension: { equals: 'country' }, period: { equals: period.toISOString() } },
			pagination: false,
		})
		const byValue = new Map(
			(docs as unknown as Array<{ dimvalue: string; [metric: string]: unknown }>).map((d) => [
				d.dimvalue,
				d,
			])
		)
		expect(byValue.get('US')).toMatchObject({ pageviews: 3, samples: 2, visitors: 1, sessions: 0 })
		expect(byValue.get('DE')).toMatchObject({ pageviews: 1, samples: 1, visitors: 1, sessions: 1 })
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

	// Through flushBatch, which is the write path every ingest actually takes.
	const hit = (visitorHash: string, country?: string): Promise<void> =>
		flushBatch(booted.payload, [
			{
				timestamp: new Date('2026-02-01T10:00:00Z'),
				type: 'pageview',
				path: '/d',
				hostname: 'h',
				visitorHash,
				sessionId: `sess-${visitorHash}`,
				country,
				durationMs: 100,
			},
		])

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

describeForDb('native flushBatch parity with the serial write path', {}, (db) => {
	let booted: BootedPayload
	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})
	afterAll(async () => {
		await booted.stop()
	})

	/**
	 * The write path as it was before the batched primitives: one upsert per bucket, one
	 * insert-if-new per visitor and session per bucket, one more upsert per new one. Kept here
	 * as the reference the batched path has to match row for row.
	 */
	const serialWrite = async (events: StoredEvent[]): Promise<void> => {
		for (const event of events) {
			const deltas = computeRollupDeltas(event)
			await applyRollupDeltas(booted.payload, deltas)
			for (const delta of deltas) {
				const bucket = bucketKey(delta.key)
				const period = delta.key.period
				for (const [kind, value, metric] of [
					['visitor', event.visitorHash, 'visitors'],
					['session', event.sessionId, 'sessions'],
				] as const) {
					if (await insertIfNew(booted.payload, SEEN_SLUG, { bucket, kind, value, period })) {
						await bumpRollup(booted.payload, delta.key, { [metric]: 1 })
					}
				}
			}
		}
	}

	// A batch with everything that makes counting interesting: two visitors sharing a session
	// hash of their own, a repeat hit, two paths, two hostnames, a custom event, a goal with
	// revenue, a scroll depth, and every classified dimension.
	const fixture = (day: string): StoredEvent[] => [
		{
			timestamp: new Date(`${day}T10:00:00Z`),
			type: 'pageview',
			path: '/a',
			hostname: 'one.example',
			visitorHash: 'p-v1',
			sessionId: 'p-s1',
			durationMs: 1000,
			scrollDepth: 60,
			country: 'US',
			region: 'CA',
			city: 'San Francisco',
			device: 'desktop',
			browser: 'chrome',
			os: 'macos',
			language: 'en-us',
			source: 'example.org',
			referrerHost: 'example.org',
			utmSource: 'newsletter',
			utmCampaign: 'spring',
		},
		{
			timestamp: new Date(`${day}T10:05:00Z`),
			type: 'pageview',
			path: '/a',
			hostname: 'one.example',
			visitorHash: 'p-v1',
			sessionId: 'p-s1',
			durationMs: 500,
			country: 'US',
			device: 'desktop',
			browser: 'chrome',
			os: 'macos',
		},
		{
			timestamp: new Date(`${day}T11:00:00Z`),
			type: 'pageview',
			path: '/b',
			hostname: 'two.example',
			visitorHash: 'p-v2',
			sessionId: 'p-s2',
			durationMs: 250,
			country: 'DE',
			device: 'mobile',
			browser: 'firefox',
			os: 'android',
			language: 'de-de',
		},
		{
			timestamp: new Date(`${day}T11:10:00Z`),
			type: 'event',
			name: 'signup',
			path: '/b',
			hostname: 'two.example',
			visitorHash: 'p-v2',
			sessionId: 'p-s2',
		},
		{
			timestamp: new Date(`${day}T11:20:00Z`),
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			hostname: 'two.example',
			visitorHash: 'p-v3',
			sessionId: 'p-s3',
			goals: [{ slug: 'purchase', value: 25.5 }],
		},
	]

	/** Every rollup row for one day, comparable across days: id and period dropped. */
	const rowsFor = async (period: Date) => {
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { period: { equals: period.toISOString() } },
			pagination: false,
			limit: 1000,
			overrideAccess: true,
		})
		return (docs as unknown as Array<Record<string, number | string>>)
			.map((d) => ({
				path: d.path,
				dimension: d.dimension,
				dimvalue: d.dimvalue,
				hostname: d.hostname,
				pageviews: d.pageviews,
				events: d.events,
				durationMs: d.durationMs,
				samples: d.samples,
				visitors: d.visitors,
				sessions: d.sessions,
				conversions: d.conversions,
				revenue: d.revenue,
				scrollDepthSum: d.scrollDepthSum,
				scrollSamples: d.scrollSamples,
			}))
			.sort((a, b) =>
				`${a.hostname}|${a.path}|${a.dimension}|${a.dimvalue}`.localeCompare(
					`${b.hostname}|${b.path}|${b.dimension}|${b.dimvalue}`
				)
			)
	}

	it(`writes exactly what the serial path wrote, bucket for bucket, on ${db}`, async () => {
		// Two days apart so both paths write their own buckets and ledger rows in one database.
		await flushBatch(booted.payload, fixture('2026-07-01'))
		await serialWrite(fixture('2026-07-02'))

		const batched = await rowsFor(new Date('2026-07-01T00:00:00Z'))
		const serial = await rowsFor(new Date('2026-07-02T00:00:00Z'))
		expect(batched).toEqual(serial)
		expect(batched.length).toBeGreaterThan(20)

		// And the numbers are the right ones, not merely the same wrong ones on both paths.
		const site = batched.find((r) => r.path === '' && r.dimension === '' && r.hostname === '')
		expect(site).toMatchObject({
			pageviews: 3,
			events: 2,
			samples: 5,
			visitors: 3,
			sessions: 3,
			durationMs: 1750,
			conversions: 1,
			revenue: 25.5,
			scrollDepthSum: 60,
			scrollSamples: 1,
		})
		const pageA = batched.find((r) => r.path === '/a' && r.hostname === '')
		expect(pageA).toMatchObject({ pageviews: 2, visitors: 1, sessions: 1 })
		const chrome = batched.find((r) => r.dimension === 'browser' && r.hostname === '')
		expect(chrome).toMatchObject({ dimvalue: 'chrome', pageviews: 2, visitors: 1 })
		const scopedHost = batched.find(
			(r) => r.hostname === 'two.example' && r.path === '' && r.dimension === ''
		)
		expect(scopedHost).toMatchObject({ pageviews: 1, events: 2, visitors: 2, sessions: 2 })
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

describeForDb('native goal rollups', {}, (db) => {
	const goals: Goal[] = [
		{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
		{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
	]
	const adapter = native()
	let booted: BootedPayload

	// Both assertions read the same two events, so they are ingested once here rather than
	// by the first test, which would leave the second unable to run on its own.
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], goals: { defaults: goals, collection: true } }),
			db,
		})
		await ingest({ type: 'pageview', path: '/thank-you' })
		await ingest({
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			value: 25.5,
			currency: 'EUR',
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = async (body: Record<string, unknown>): Promise<void> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(ingestRequest(booted.payload, { hostname: 'h', ...body }))
		expect(res.status).toBe(202)
	}

	const rollupRow = async (where: Record<string, unknown>) => {
		const { docs } = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: where as never,
			pagination: false,
			overrideAccess: true,
		})
		return docs[0] as unknown as { conversions: number; revenue: number } | undefined
	}

	it(`counts conversions and revenue site-wide and per goal on ${db}`, async () => {
		const site = await rollupRow({
			path: { equals: '' },
			dimension: { equals: '' },
			hostname: { equals: '' },
		})
		expect(site?.conversions).toBe(2)
		expect(site?.revenue).toBe(25.5)

		const purchase = await rollupRow({
			dimension: { equals: 'goal' },
			dimvalue: { equals: 'purchase' },
			hostname: { equals: '' },
		})
		expect(purchase?.conversions).toBe(1)
		expect(purchase?.revenue).toBe(25.5)

		const thanks = await rollupRow({
			dimension: { equals: 'goal' },
			dimvalue: { equals: 'thanks' },
			hostname: { equals: '' },
		})
		expect(thanks?.conversions).toBe(1)
		expect(thanks?.revenue).toBe(0)
	})

	it(`keeps one goal document per slug on ${db}`, async () => {
		const demo = { name: 'Demo', slug: 'demo', match: { kind: 'goal' } }
		await booted.payload.create({ collection: GOALS_SLUG, data: demo as never })
		// The hook answers first; the collection's unique index is the storage-level backstop.
		await expect(
			booted.payload.create({ collection: GOALS_SLUG, data: { ...demo, name: 'Demo 2' } as never })
		).rejects.toMatchObject({ data: { errors: [{ path: 'slug' }] } })
	})

	it(`returns one breakdown row per goal through the adapter on ${db}`, async () => {
		const now = new Date()
		const result = await adapter.query(
			{
				metrics: ['conversions', 'revenue'],
				dimensions: ['goal'],
				dateRange: { start: new Date(now.getTime() - 86_400_000), end: now },
			},
			{}
		)
		const byGoal = Object.fromEntries(result.rows.map((row) => [row.dimensions?.goal, row.metrics]))
		expect(byGoal.purchase).toEqual({ conversions: 1, revenue: 25.5 })
		expect(byGoal.thanks).toEqual({ conversions: 1, revenue: 0 })
		expect(result.totals).toEqual({ conversions: 2, revenue: 25.5 })
	})
})

describeForDb('native dimension columns and breakdowns', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	// One ingest carrying every attribute the new dimensions are derived from, so each
	// breakdown has exactly one row to find on either database.
	const attributed = {
		'user-agent':
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		'accept-language': 'de-DE,de;q=0.9',
		'x-vercel-ip-country': 'US',
		'x-vercel-ip-country-region': 'CA',
		'x-vercel-ip-city': 'San Francisco',
	}

	const expected: ReadonlyArray<readonly [DimensionKey, string]> = [
		['referrer', 'example.org'],
		['region', 'CA'],
		['city', 'San Francisco'],
		['browser', 'chrome'],
		['os', 'macos'],
		['language', 'de-de'],
		['utmSource', 'newsletter'],
		['utmMedium', 'email'],
		['utmCampaign', 'spring'],
		['utmContent', 'hero'],
		['utmTerm', 'shoes'],
	]

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(
				booted.payload,
				{
					type: 'pageview',
					path: '/dims',
					hostname: 'site.com',
					referrer: 'https://www.example.org/path?x=1',
					query:
						'utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=shoes',
					durationMs: 100,
				},
				attributed
			)
		)
		expect(res.status).toBe(202)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`stores every derived dimension column on ${db}`, async () => {
		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/dims' } } as never,
			pagination: false,
			overrideAccess: true,
		})
		expect(docs[0]).toMatchObject({
			referrerHost: 'example.org',
			region: 'CA',
			city: 'San Francisco',
			browser: 'chrome',
			os: 'macos',
			language: 'de-de',
			utmSource: 'newsletter',
			utmMedium: 'email',
			utmCampaign: 'spring',
			utmContent: 'hero',
			utmTerm: 'shoes',
		})
	})

	it(`serves a rollup and a raw-event breakdown per new dimension on ${db}`, async () => {
		const range = { start: new Date('2020-01-01'), end: new Date('2030-01-01') }
		for (const [dimension, value] of expected) {
			const rollups = await adapter.query(
				{ metrics: ['pageviews'], dimensions: [dimension], dateRange: range },
				{}
			)
			expect(rollups.rows).toEqual([
				{ dimensions: { [dimension]: value }, metrics: { pageviews: 1 } },
			])
			// A filter forces the raw-event path, which must agree with the rollups.
			const events = await adapter.query(
				{
					metrics: ['pageviews'],
					dimensions: [dimension],
					dateRange: range,
					filters: [{ dimension, operator: 'eq', value }],
				},
				{}
			)
			expect(events.rows).toEqual(rollups.rows)
		}
	})
})

/** Deterministic printable ASCII with no repeating run for PGLZ to squeeze out. */
const noise = (length: number): string => {
	let seed = 12345
	let out = ''
	for (let i = 0; i < length; i++) {
		seed = (seed * 1103515245 + 12345) % 2147483648
		out += String.fromCharCode(33 + (seed % 94))
	}
	return out
}

describeForDb('native geo caps', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	// A geo header is client-settable, and its value becomes a rollup dimvalue and part of a
	// seen-ledger key. Uncapped, an oversized one blows past Postgres's 2704-byte btree key
	// limit and fails the write while Mongo accepts it, so the databases would disagree about
	// whether the hit counted at all. The fixture has to be incompressible: Postgres compresses
	// index values, so 3 KB of one repeated character would fit the key and prove nothing.
	it(`truncates an oversized geo header instead of failing the write on ${db}`, async () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path: '/geo', hostname: 'site.com', durationMs: 100 },
				{ 'user-agent': 'UA', 'x-vercel-ip-city': noise(3000) }
			)
		)
		expect(res.status).toBe(202)

		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/geo' } } as never,
			pagination: false,
			overrideAccess: true,
		})
		expect((docs[0] as unknown as { city: string }).city).toHaveLength(MAX_GEO_LENGTH)

		const rows = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				dimensions: ['city'],
				dateRange: { start: new Date('2020-01-01'), end: new Date('2030-01-01') },
			},
			{}
		)
		expect(rows.rows).toEqual([
			{
				dimensions: { city: noise(3000).slice(0, MAX_GEO_LENGTH) },
				metrics: { pageviews: 1, visitors: 1 },
			},
		])
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
		makeIngestHandler(platformHeaderResolver)(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname: 'h', durationMs: 200 },
				{ 'x-vercel-ip-country': 'US' }
			)
		)

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

describeForDb('native scoped ingest and reads', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				access: { platformRead: ({ req }) => Boolean(req.user) },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = async (tenant: string | null, path: string, ua = 'UA'): Promise<void> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
				{ 'user-agent': ua, ...(tenant ? { 'x-tenant': tenant } : {}) }
			)
		)
		expect(res.status).toBe(202)
	}

	const widgetReq = (tenant?: string, user?: object): PayloadRequest =>
		({
			payload: booted.payload,
			headers: new Headers(tenant ? { 'x-tenant': tenant } : {}),
			user: user ?? null,
		}) as unknown as PayloadRequest

	it(`stamps ingested events and rollups with the resolved scope on ${db}`, async () => {
		await ingest('t1', '/scoped')
		await ingest('t1', '/scoped', 'UA-second-visitor')
		await ingest('t2', '/scoped')
		await ingest(null, '/scoped')

		const rollups = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/scoped' }, dimension: { equals: '' } },
			pagination: false,
			overrideAccess: true,
		})
		const byScope = new Map(
			(
				rollups.docs as unknown as Array<{ scope: string; pageviews: number; visitors: number }>
			).map((d) => [d.scope, d])
		)
		expect(byScope.get('t1')?.pageviews).toBe(2)
		expect(byScope.get('t1')?.visitors).toBe(2)
		expect(byScope.get('t2')?.pageviews).toBe(1)
		expect(byScope.get('')?.pageviews).toBe(1)
	})

	it(`keeps the same visitor distinct per scope on ${db}`, async () => {
		await ingest('t1', '/dedupe', 'UA-shared')
		await ingest('t1', '/dedupe', 'UA-shared')
		await ingest('t2', '/dedupe', 'UA-shared')
		const rollups = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/dedupe' } },
			pagination: false,
			overrideAccess: true,
		})
		const byScope = new Map(
			(
				rollups.docs as unknown as Array<{ scope: string; pageviews: number; visitors: number }>
			).map((d) => [d.scope, d])
		)
		expect(byScope.get('t1')?.pageviews).toBe(2)
		expect(byScope.get('t1')?.visitors).toBe(1)
		expect(byScope.get('t2')?.pageviews).toBe(1)
		expect(byScope.get('t2')?.visitors).toBe(1)
	})

	it(`filters widget reads by the request's scope on ${db}`, async () => {
		const t1 = await readForWidget({
			req: widgetReq('t1'),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
		})
		expect(t1.status).toBe('ok')
		expect(t1.metrics.pageviews).toBe(4)

		const t2 = await readForWidget({
			req: widgetReq('t2'),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
		})
		expect(t2.metrics.pageviews).toBe(2)
	})

	it(`aggregates across scopes only for permitted platform reads on ${db}`, async () => {
		const denied = await readForWidget({
			req: widgetReq('t1'),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
			scope: '*',
		})
		expect(denied.status).toBe('unavailable')

		const allowed = await readForWidget({
			req: widgetReq('t1', { id: 'admin' }),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
			scope: '*',
		})
		expect(allowed.status).toBe('ok')
		expect(allowed.metrics.pageviews).toBe(7)
	})
})

describeForDb('native reporting timezone bucketing', {}, (db) => {
	const TZ = 'America/New_York'
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], reportingTimezone: TZ }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = async (): Promise<void> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(booted.payload, {
				type: 'pageview',
				path: '/tz',
				hostname: 'h',
				durationMs: 100,
			})
		)
		expect(res.status).toBe(202)
	}

	it(`buckets the rollup period at the reporting timezone's local day on ${db}`, async () => {
		await ingest()
		const events = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/tz' } },
			pagination: false,
			overrideAccess: true,
		})
		const eventTs = new Date((events.docs[0] as unknown as { timestamp: string }).timestamp)
		const rollups = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/tz' }, dimension: { equals: '' } },
			pagination: false,
			overrideAccess: true,
		})
		const period = new Date((rollups.docs[0] as unknown as { period: string }).period)
		expect(period.toISOString()).toBe(startOfDayInTz(eventTs, TZ).toISOString())
	})
})

describeForDb('custom range end bound', {}, (db) => {
	const TZ = 'Europe/Berlin'
	let booted: BootedPayload

	// Jun 23 in Berlin ends at 2026-06-23T21:59:59.999Z, so 23:30 local is the last event
	// inside the picked window and 00:30 the next morning is the first one outside it.
	const pageview = (timestamp: string, visitor: string): StoredEvent => ({
		timestamp: new Date(timestamp),
		type: 'pageview',
		path: '/cr',
		hostname: 'h',
		visitorHash: visitor,
		sessionId: `${visitor}-s`,
		timezone: TZ,
	})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], reportingTimezone: TZ }),
			db,
		})
		await flushBatch(booted.payload, [
			pageview('2026-06-23T21:30:00.000Z', 'in'),
			pageview('2026-06-23T22:30:00.000Z', 'out'),
		])
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`includes the final picked day up to its last instant on ${db}`, async () => {
		const range = resolveCustomRange('custom', { from: '2026-06-01', to: '2026-06-23' }, TZ)
		expect(range?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')
		const req = { payload: booted.payload } as unknown as PayloadRequest
		const args = {
			req,
			metrics: ['pageviews' as const],
			timeframe: 'last30days' as const,
			now: new Date(),
			range,
			timezone: TZ,
		}
		// Day rollups, whose period is bucketed on the reporting timezone's day.
		const rollups = await readForWidget(args)
		expect(rollups.status).toBe('ok')
		expect(rollups.metrics.pageviews).toBe(1)
		// And raw events, where the adapter compares the end instant itself.
		const raw = await readForWidget({
			...args,
			filters: [{ dimension: 'page', operator: 'eq', value: '/cr' }],
		})
		expect(raw.status).toBe('ok')
		expect(raw.metrics.pageviews).toBe(1)
	})
})

describeForDb('reportingTimezone resolver (per-tenant)', {}, (db) => {
	const TZ_A = 'America/New_York'
	const TZ_B = 'Asia/Tokyo'
	const TENANT_A = 'tenant-a'
	const TENANT_B = 'tenant-b'
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant-id'),
				reportingTimezone: ({ scope }) => {
					if (scope === TENANT_A) return TZ_A
					if (scope === TENANT_B) return TZ_B
					return null
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = async (tenantId: string, path: string): Promise<void> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
				{ 'x-tenant-id': tenantId }
			)
		)
		expect(res.status).toBe(202)
	}

	const rollupPeriodFor = async (path: string): Promise<Date> => {
		const rollups = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: path }, dimension: { equals: '' } },
			pagination: false,
			overrideAccess: true,
		})
		return new Date((rollups.docs[0] as unknown as { period: string }).period)
	}

	const eventTimestampFor = async (path: string): Promise<Date> => {
		const events = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: path } },
			pagination: false,
			overrideAccess: true,
		})
		return new Date((events.docs[0] as unknown as { timestamp: string }).timestamp)
	}

	it(`buckets tenant-a events at ${TZ_A} local day on ${db}`, async () => {
		await ingest(TENANT_A, '/tz-a')
		const ts = await eventTimestampFor('/tz-a')
		const period = await rollupPeriodFor('/tz-a')
		expect(period.toISOString()).toBe(startOfDayInTz(ts, TZ_A).toISOString())
	})

	it(`buckets tenant-b events at ${TZ_B} local day on ${db}`, async () => {
		await ingest(TENANT_B, '/tz-b')
		const ts = await eventTimestampFor('/tz-b')
		const period = await rollupPeriodFor('/tz-b')
		expect(period.toISOString()).toBe(startOfDayInTz(ts, TZ_B).toISOString())
	})

	it(`falls back to UTC when resolver returns null (no tenant header) on ${db}`, async () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(
			ingestRequest(booted.payload, {
				type: 'pageview',
				path: '/tz-fallback',
				hostname: 'h',
				durationMs: 100,
			})
		)
		expect(res.status).toBe(202)
		const ts = await eventTimestampFor('/tz-fallback')
		const period = await rollupPeriodFor('/tz-fallback')
		expect(period.toISOString()).toBe(startOfDayInTz(ts, 'UTC').toISOString())
	})
})

describeForDb(
	'reportingTimezone invalid/null/throwing → UTC fallback',
	{ dbs: ['mongo'] },
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({
				plugin: analytics({
					adapters: [native()],
					// Resolver returns null for unknown scopes and throws for 'bad-scope'.
					reportingTimezone: ({ scope }) => {
						if (scope === 'bad-scope') throw new Error('simulated resolver failure')
						return null
					},
				}),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		const ingestViaEndpoint = async (tenantId: string | null, path: string): Promise<void> => {
			const endpoint = (booted.payload.config.endpoints ?? []).find(
				(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
			)
			if (!endpoint || typeof endpoint.handler !== 'function') {
				throw new Error('ingest endpoint not registered')
			}
			const res = await endpoint.handler(
				ingestRequest(
					booted.payload,
					{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
					tenantId !== null ? { 'x-tenant-id': tenantId } : {}
				)
			)
			expect(res.status).toBe(202)
		}

		const rollupPeriodFor = async (path: string): Promise<Date> => {
			const rollups = await booted.payload.find({
				collection: ROLLUPS_SLUG,
				where: { path: { equals: path }, dimension: { equals: '' } },
				pagination: false,
				overrideAccess: true,
			})
			return new Date((rollups.docs[0] as unknown as { period: string }).period)
		}

		const eventTimestampFor = async (path: string): Promise<Date> => {
			const events = await booted.payload.find({
				collection: EVENTS_SLUG as never,
				where: { path: { equals: path } },
				pagination: false,
				overrideAccess: true,
			})
			return new Date((events.docs[0] as unknown as { timestamp: string }).timestamp)
		}

		it(`buckets in UTC when resolver returns null on ${db}`, async () => {
			await ingestViaEndpoint(null, '/tz-null')
			const ts = await eventTimestampFor('/tz-null')
			const period = await rollupPeriodFor('/tz-null')
			expect(period.toISOString()).toBe(startOfDayInTz(ts, 'UTC').toISOString())
		})

		it(`buckets in UTC and does not throw when resolver throws on ${db}`, async () => {
			await ingestViaEndpoint('bad-scope', '/tz-throw')
			const ts = await eventTimestampFor('/tz-throw')
			const period = await rollupPeriodFor('/tz-throw')
			expect(period.toISOString()).toBe(startOfDayInTz(ts, 'UTC').toISOString())
		})

		it(`buckets in UTC for an invalid IANA string on ${db}`, async () => {
			let booted2: BootedPayload | undefined
			try {
				booted2 = await bootPayload({
					plugin: analytics({ adapters: [native()], reportingTimezone: 'Not/ATimezone' }),
					db,
				})
				const endpoint = (booted2.payload.config.endpoints ?? []).find(
					(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
				)
				if (!endpoint || typeof endpoint.handler !== 'function') throw new Error('no endpoint')
				const res = await endpoint.handler(
					ingestRequest(booted2.payload, {
						type: 'pageview',
						path: '/tz-invalid',
						hostname: 'h',
						durationMs: 100,
					})
				)
				expect(res.status).toBe(202)
				const rollups = await booted2.payload.find({
					collection: ROLLUPS_SLUG,
					where: { path: { equals: '/tz-invalid' }, dimension: { equals: '' } },
					pagination: false,
					overrideAccess: true,
				})
				const events = await booted2.payload.find({
					collection: EVENTS_SLUG as never,
					where: { path: { equals: '/tz-invalid' } },
					pagination: false,
					overrideAccess: true,
				})
				const ts = new Date((events.docs[0] as unknown as { timestamp: string }).timestamp)
				const period = new Date((rollups.docs[0] as unknown as { period: string }).period)
				expect(period.toISOString()).toBe(startOfDayInTz(ts, 'UTC').toISOString())
			} finally {
				await booted2?.stop()
			}
		})
	}
)

describeForDb('analytics sync tier', {}, (db) => {
	const DAY = 86_400_000
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native(), mem], sync: true }), db })
		for (let offset = 0; offset < 3; offset++) {
			const t = new Date(Date.now() - offset * DAY)
			mem.record({ path: '/p', timestamp: t, visitor: 'a' })
			mem.record({ path: '/p', timestamp: t, visitor: 'b' })
		}
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqOf = (): PayloadRequest => ({ payload: booted.payload }) as unknown as PayloadRequest

	const runSync = async (): Promise<{ synced: number; failed: number }> => {
		const task = syncTask({
			cron: '0 */6 * * *',
			lookbackDays: 3,
			collectionSlug: 'analytics-daily',
		})
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('sync handler must be a function')
		}
		const result = await handler({ req: reqOf() } as unknown as Parameters<typeof handler>[0])
		return (result as { output: { synced: number; failed: number } }).output
	}

	it('registers the analytics-daily collection and the sync task with its cron', () => {
		const config = booted.payload.config as unknown as {
			collections?: Array<{ slug?: string }>
			jobs?: { tasks?: Array<{ slug?: string; schedule?: Array<{ cron?: string }> }> }
		}
		expect((config.collections ?? []).some((c) => c.slug === 'analytics-daily')).toBe(true)
		const task = (config.jobs?.tasks ?? []).find((t) => t.slug === SYNC_TASK_SLUG)
		expect(task?.schedule?.[0]?.cron).toBe('0 */6 * * *')
	})

	it('upserts one row per (provider source, day) and excludes native', async () => {
		const out = await runSync()
		expect(out.failed).toBe(0)
		expect(out.synced).toBe(3)
		const docs = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 100,
			sort: 'date',
			overrideAccess: true,
		})
		expect(docs.docs.length).toBe(3)
		for (const doc of docs.docs as unknown as Array<{
			source: string
			pageviews: number
			visitors: number
			date: string
			scope: string
		}>) {
			expect(doc.source).toBe('memory')
			expect(doc.pageviews).toBe(2)
			expect(doc.visitors).toBe(2)
			expect(doc.date).toBeTruthy()
			expect(doc.scope).toBe('')
		}
	})

	it('is idempotent: a second run updates in place with no duplicates', async () => {
		const before = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 0,
			overrideAccess: true,
		})
		await runSync()
		const after = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 0,
			overrideAccess: true,
		})
		expect(after.totalDocs).toBe(before.totalDocs)
		expect(after.totalDocs).toBe(3)
	})
})

describeForDb('native hostname family uniqueness', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = (path: string, hostname: string, ua: string) =>
		makeIngestHandler(platformHeaderResolver)(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path, hostname, durationMs: 100 },
				{ 'user-agent': ua }
			)
		)

	it(`keeps per-hostname rollup buckets exact and separate from the merged family on ${db}`, async () => {
		await ingest('/hf', 'a.example', 'UA-A1')
		await ingest('/hf', 'b.example', 'UA-B1')

		const rollups = await booted.payload.find({
			collection: ROLLUPS_SLUG,
			where: { path: { equals: '/hf' }, dimension: { equals: '' } },
			pagination: false,
			overrideAccess: true,
		})
		const byHostname = new Map(
			(rollups.docs as unknown as Array<{ hostname: string; pageviews: number }>).map((d) => [
				d.hostname,
				d,
			])
		)
		expect(byHostname.get('')?.pageviews).toBe(2)
		expect(byHostname.get('a.example')?.pageviews).toBe(1)
		expect(byHostname.get('b.example')?.pageviews).toBe(1)
	})

	it(`rejects a raw duplicate-bucket insert, proving the widened unique index on ${db}`, async () => {
		const row = {
			granularity: 'day',
			period: new Date('2026-05-01T00:00:00Z'),
			path: '/dup',
			dimension: '',
			dimvalue: '',
			hostname: 'a.example',
			pageviews: 1,
			events: 0,
			durationMs: 0,
			visitors: 0,
			sessions: 0,
			samples: 0,
		}
		await rawInsertRollup(booted.payload, row)
		await expect(rawInsertRollup(booted.payload, row)).rejects.toThrow()
	})
})

describeForDb('analytics sync tier: scope fan-out', {}, (db) => {
	const DAY = 86_400_000
	let booted: BootedPayload
	let memRoot: MemoryAnalyticsAdapter
	let memT1: MemoryAnalyticsAdapter
	let memT2: MemoryAnalyticsAdapter
	let memShared: MemoryAnalyticsAdapter

	beforeAll(async () => {
		memRoot = { ...memoryAdapter(), id: 'memory:root' }
		memT1 = { ...memoryAdapter(), id: 'memory:t1' }
		memT2 = { ...memoryAdapter(), id: 'memory:t2' }
		// A CONFIG adapter (declared in `adapters`, not resolved per scope) that never
		// declares scopedQueries: it cannot narrow its own query to one tenant, so the
		// sync loop must only pull it for the install-wide (null) pass.
		memShared = { ...memoryAdapter(), id: 'shared' }
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native(), memShared],
				sync: true,
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				scopes: () => ['t1', 't2'],
				providers: {
					resolve: ({ scope }) => {
						if (scope === 't1') return [memT1]
						if (scope === 't2') return [memT2]
						return [memRoot]
					},
				},
			}),
			db,
		})
		const t = new Date(Date.now() - DAY)
		memRoot.record({ path: '/p', timestamp: t, visitor: 'a' })
		memRoot.record({ path: '/p', timestamp: t, visitor: 'b' })
		memT1.record({ path: '/p', timestamp: t, visitor: 'a' })
		memT2.record({ path: '/p', timestamp: t, visitor: 'a' })
		memT2.record({ path: '/p', timestamp: t, visitor: 'b' })
		memT2.record({ path: '/p', timestamp: t, visitor: 'c' })
		memShared.record({ path: '/p', timestamp: t, visitor: 'a' })
		memShared.record({ path: '/p', timestamp: t, visitor: 'b' })
		memShared.record({ path: '/p', timestamp: t, visitor: 'c' })
		memShared.record({ path: '/p', timestamp: t, visitor: 'd' })
		memShared.record({ path: '/p', timestamp: t, visitor: 'e' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqOf = (): PayloadRequest => ({ payload: booted.payload }) as unknown as PayloadRequest

	const runSync = async (): Promise<{ synced: number; failed: number }> => {
		const task = syncTask({
			cron: '0 */6 * * *',
			lookbackDays: 3,
			collectionSlug: 'analytics-daily',
			scopes: () => ['t1', 't2'],
		})
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('sync handler must be a function')
		}
		const result = await handler({ req: reqOf() } as unknown as Parameters<typeof handler>[0])
		return (result as { output: { synced: number; failed: number } }).output
	}

	it(`syncs one row per scope, each reading that scope's own resolved provider on ${db}`, async () => {
		const out = await runSync()
		expect(out.failed).toBe(0)
		expect(out.synced).toBe(4)
		const docs = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 100,
			overrideAccess: true,
		})
		const byScope = new Map(
			(docs.docs as unknown as Array<{ scope: string; source: string; pageviews: number }>)
				.filter((d) => d.source !== 'shared')
				.map((d) => [d.scope, d])
		)
		expect(byScope.get('')?.pageviews).toBe(2)
		expect(byScope.get('t1')?.pageviews).toBe(1)
		expect(byScope.get('t2')?.pageviews).toBe(3)
	})

	it(`only ever syncs a shared (non-scoped) config adapter into the install-wide scope on ${db}`, async () => {
		const docs = await booted.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'shared' } },
			limit: 100,
			overrideAccess: true,
		})
		const rows = docs.docs as unknown as Array<{ scope: string; pageviews: number }>
		expect(rows).toHaveLength(1)
		expect(rows[0]?.scope).toBe('')
		expect(rows[0]?.pageviews).toBe(5)
	})

	it(`is idempotent across scopes: a second run updates in place with no duplicates on ${db}`, async () => {
		const before = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 0,
			overrideAccess: true,
		})
		await runSync()
		const after = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 0,
			overrideAccess: true,
		})
		expect(after.totalDocs).toBe(before.totalDocs)
		expect(after.totalDocs).toBe(4)
	})

	it(`a tenant's find with overrideAccess: false returns only their scope's rows on ${db}`, async () => {
		const { docs } = await booted.payload.find({
			collection: 'analytics-daily' as never,
			limit: 100,
			overrideAccess: false,
			user: { id: 'u1' },
			req: { headers: new Headers({ 'x-tenant': 't1' }) } as unknown as PayloadRequest,
		})
		expect(docs.length).toBeGreaterThan(0)
		expect((docs as unknown as Array<{ scope: string }>).every((d) => d.scope === 't1')).toBe(true)
	})
})

describeForDb('analytics sync tier: per-scope resolution isolation', {}, (db) => {
	const DAY = 86_400_000
	let booted: BootedPayload
	let memT2: MemoryAnalyticsAdapter

	beforeAll(async () => {
		memT2 = { ...memoryAdapter(), id: 'memory:t2' }
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				sync: true,
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				scopes: () => ['t1', 't2'],
				providers: {
					resolve: ({ scope }) => {
						if (scope === 't1') throw new Error('boom')
						if (scope === 't2') return [memT2]
						return []
					},
				},
			}),
			db,
		})
		const t = new Date(Date.now() - DAY)
		memT2.record({ path: '/p', timestamp: t, visitor: 'a' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqOf = (): PayloadRequest => ({ payload: booted.payload }) as unknown as PayloadRequest

	it(`a registry resolution failure for one scope does not abort the others on ${db}`, async () => {
		const task = syncTask({
			cron: '0 */6 * * *',
			lookbackDays: 3,
			collectionSlug: 'analytics-daily',
			scopes: () => ['t1', 't2'],
		})
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('sync handler must be a function')
		}
		const result = await handler({ req: reqOf() } as unknown as Parameters<typeof handler>[0])
		const out = (result as { output: { synced: number; failed: number } }).output
		expect(out.failed).toBeGreaterThanOrEqual(1)
		expect(out.synced).toBeGreaterThanOrEqual(1)
		const docs = await booted.payload.find({
			collection: 'analytics-daily' as never,
			where: { scope: { equals: 't2' } },
			limit: 100,
			overrideAccess: true,
		})
		expect(docs.docs.length).toBeGreaterThanOrEqual(1)
	})
})

describeForDb('form-builder action block composition', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], goals: { defaults: actionGoals } }),
			collections: [actionHost()],
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`stores the action config under the action block slug on ${db}`, async () => {
		const created = await booted.payload.create({
			collection: ACTION_HOST_SLUG as never,
			data: {
				actions: [{ blockType: GOAL_ACTION_TYPE, goal: 'book-demo', value: 40, currency: 'EUR' }],
			} as never,
		})
		const read = await booted.payload.findByID({
			collection: ACTION_HOST_SLUG as never,
			id: (created as { id: string | number }).id,
		})
		expect((read as { actions?: Array<Record<string, unknown>> }).actions?.[0]).toMatchObject({
			blockType: GOAL_ACTION_TYPE,
			goal: 'book-demo',
			value: 40,
			currency: 'EUR',
		})
	})
})
