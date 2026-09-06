import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config, Endpoint, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
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
import { SYNC_TASK_SLUG, syncTask } from '../../src/sync/syncTask'
import { type MemoryAnalyticsAdapter, memoryAdapter } from '../../src/testing/memoryAdapter'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { readForWidget } from '../../src/widgets/readForWidget'

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
		const headers = new Headers({ 'content-type': 'application/json', 'user-agent': ua })
		if (tenant) {
			headers.set('x-tenant', tenant)
		}
		const res = await endpoint.handler({
			payload: booted.payload,
			headers,
			json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 100 }),
		} as never)
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
		const res = await endpoint.handler({
			payload: booted.payload,
			headers: new Headers({ 'content-type': 'application/json', 'user-agent': 'UA' }),
			json: async () => ({ type: 'pageview', path: '/tz', hostname: 'h', durationMs: 100 }),
		} as never)
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
		const res = await endpoint.handler({
			payload: booted.payload,
			headers: new Headers({
				'content-type': 'application/json',
				'user-agent': 'UA',
				'x-tenant-id': tenantId,
			}),
			json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 100 }),
		} as never)
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
		const res = await endpoint.handler({
			payload: booted.payload,
			headers: new Headers({ 'content-type': 'application/json', 'user-agent': 'UA' }),
			json: async () => ({
				type: 'pageview',
				path: '/tz-fallback',
				hostname: 'h',
				durationMs: 100,
			}),
		} as never)
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
			const headers = new Headers({ 'content-type': 'application/json', 'user-agent': 'UA' })
			if (tenantId !== null) {
				headers.set('x-tenant-id', tenantId)
			}
			const res = await endpoint.handler({
				payload: booted.payload,
				headers,
				json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 100 }),
			} as never)
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
				const res = await endpoint.handler({
					payload: booted2.payload,
					headers: new Headers({ 'content-type': 'application/json', 'user-agent': 'UA' }),
					json: async () => ({
						type: 'pageview',
						path: '/tz-invalid',
						hostname: 'h',
						durationMs: 100,
					}),
				} as never)
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
		makeIngestHandler(platformHeaderResolver)({
			payload: booted.payload,
			headers: new Headers({ 'content-type': 'application/json', 'user-agent': ua }),
			json: async () => ({ type: 'pageview', path, hostname, durationMs: 100 }),
		} as never)

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
