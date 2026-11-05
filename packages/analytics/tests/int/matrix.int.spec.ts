import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { PayloadRequest, Where } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DimensionKey } from '../../src/core/contract'
import { DEFAULT_JOBS } from '../../src/core/jobs'
import { resolveRequestedScope } from '../../src/core/scopedRead'
import { readForField } from '../../src/fields/readForDocument'
import { GOALS_SLUG } from '../../src/goals/collection'
import { GOAL_ACTION_TYPE } from '../../src/goals/trackGoalAction'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { CHANNEL_TAXONOMY_VERSION, type TrafficChannel } from '../../src/native/ingest/source'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime } from '../../src/plugin/runtime'
import { MAX_GEO_LENGTH } from '../../src/query/limits'
import { SYNC_SLUG } from '../../src/sync/collection'
import {
	SYNC_TASK_SLUG,
	type SyncTaskOptions,
	type SyncTaskOutput,
	syncTask,
} from '../../src/sync/syncTask'
import { type MemoryAnalyticsAdapter, memoryAdapter } from '../../src/testing/memoryAdapter'
import { calendarDayOf } from '../../src/timeframe/calendar'
import { DAY_MS, startOfDayInTz } from '../../src/timeframe/tz'
import { resolveCustomRange } from '../../src/widgets/range'
import { readForWidget } from '../../src/widgets/readForWidget'
import { ACTION_HOST_SLUG, actionHost } from './actionHost'
import { INGEST_HOST } from './ingestRequest'
import {
	aroundNow,
	ingestDirect,
	nativeOf,
	postBeacon,
	storedHits,
	storeEvents,
} from './nativeHelpers'
import { readerRequest } from './readerRequest'

/** Posts a beacon to the mounted ingest endpoint and expects it taken (202). */
const ingestAccepted = async (
	booted: BootedPayload,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
): Promise<void> => {
	expect((await postBeacon(booted.payload, body, headers)).status).toBe(202)
}

/** Pageviews per value of one dimension, read through the adapter around now. */
const breakdownOf = async (
	booted: BootedPayload,
	adapter: ReturnType<typeof native>,
	dimension: DimensionKey
): Promise<Record<string, number>> => {
	const result = await adapter.query(
		{ metrics: ['pageviews'], dimensions: [dimension], dateRange: aroundNow() },
		{ payload: booted.payload }
	)
	return Object.fromEntries(
		result.rows.map((row) => [String(row.dimensions?.[dimension]), row.metrics.pageviews ?? 0])
	)
}

/** The local day start, in `tz`, of the one stored hit on `path`. */
const hitDayStart = async (booted: BootedPayload, path: string, tz: string): Promise<string> => {
	const [hit] = await storedHits(booted.payload, { path: { equals: path } })
	return startOfDayInTz(new Date(String(hit?.ts)), tz).toISOString()
}

/** The day start of every day a series read of `path` counted pageviews on. */
const seriesDays = async (
	booted: BootedPayload,
	adapter: ReturnType<typeof native>,
	query: { path: string; scope?: string; timezone?: string }
): Promise<string[]> => {
	const result = await adapter.query(
		{ ...query, metrics: ['pageviews'], granularity: 'day', dateRange: aroundNow() },
		{ payload: booted.payload }
	)
	return result.rows
		.filter((row) => (row.metrics.pageviews ?? 0) > 0)
		.map((row) => String(row.timestamp))
}

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

describeForDb('native distinct counting', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	/** Every hit's instant: a visitor seen on two days counts on each, so all land on one. */
	let at: Date
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		at = new Date()
	})
	afterAll(async () => {
		await booted.stop()
	})

	// Through the store, which is the one write every ingest ends in.
	const hit = (visitorId: string): Promise<unknown> =>
		storeEvents(booted.payload, [
			{ timestamp: at, type: 'pageview', path: '/d', hostname: 'h', visitorId, durationMs: 100 },
		])

	const totals = async () =>
		(
			await adapter.query(
				{ path: '/d', metrics: ['pageviews', 'visitors', 'sessions'], dateRange: aroundNow() },
				{ payload: booted.payload }
			)
		).totals

	it(`counts a repeat visitor once but pageviews twice on ${db}`, async () => {
		await hit('vv1')
		await hit('vv1')
		expect(await totals()).toEqual({ pageviews: 2, visitors: 1, sessions: 1 })
	})

	it(`counts two distinct visitors as two on ${db}`, async () => {
		await hit('vv2')
		await hit('vv3')
		// vv1 (prior test) + vv2 + vv3 all share the '/d' path: 3 distinct visitors.
		expect((await totals())?.visitors).toBe(3)
	})
})

describeForDb('native goals', {}, (db) => {
	const goals: Goal[] = [
		{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
		{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
	]
	const adapter = native()
	let booted: BootedPayload

	const ingest = (body: Record<string, unknown>): Promise<void> =>
		ingestAccepted(booted, { hostname: 'h', ...body })

	// Both assertions read the same two events, so they are ingested once here rather than
	// by the first test, which would leave the second unable to run on its own.
	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: goals, collection: true },
			}),
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

	const totalsOf = async (goal?: string) =>
		(
			await adapter.query(
				{
					metrics: ['conversions', 'revenue'],
					dateRange: aroundNow(),
					...(goal ? { filters: [{ dimension: 'goal', operator: 'eq', value: goal }] } : {}),
				},
				{ payload: booted.payload }
			)
		).totals

	it(`counts conversions and revenue site-wide and per goal on ${db}`, async () => {
		expect(await totalsOf()).toEqual({ conversions: 2, revenue: 25.5 })
		expect(await totalsOf('purchase')).toEqual({ conversions: 1, revenue: 25.5 })
		expect(await totalsOf('thanks')).toEqual({ conversions: 1, revenue: 0 })
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
		const result = await adapter.query(
			{ metrics: ['conversions', 'revenue'], dimensions: ['goal'], dateRange: aroundNow() },
			{ payload: booted.payload }
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

	// One ingest carrying every attribute the derived dimensions come from, so each breakdown
	// has exactly one row to find on every database.
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
		booted = await bootPayload({
			// The fixture carries Vercel's location headers, which only a Vercel install reads.
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				trustedPlatform: 'vercel',
			}),
			db,
		})
		await ingestAccepted(
			booted,
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
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`stores every derived dimension column on ${db}`, async () => {
		const docs = await storedHits(booted.payload, { path: { equals: '/dims' } })
		expect(docs[0]).toMatchObject({
			ref: 'example.org',
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

	it(`serves a breakdown per derived dimension, and the same with a filter on it on ${db}`, async () => {
		for (const [dimension, value] of expected) {
			const plain = await adapter.query(
				{ metrics: ['pageviews'], dimensions: [dimension], dateRange: aroundNow() },
				{ payload: booted.payload }
			)
			expect(plain.rows).toEqual([
				{ dimensions: { [dimension]: value }, metrics: { pageviews: 1 } },
			])
			const filtered = await adapter.query(
				{
					metrics: ['pageviews'],
					dimensions: [dimension],
					dateRange: aroundNow(),
					filters: [{ dimension, operator: 'eq', value }],
				},
				{ payload: booted.payload }
			)
			expect(filtered.rows).toEqual(plain.rows)
		}
	})
})

describeForDb('native channels and sources', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	interface Hit {
		path: string
		referrer?: string
		query?: string
	}

	// One hit per channel, each its own visitor and visit, through the real ingest endpoint, so
	// every `channel` value is written and read back on each database beside its `source`.
	const hits: ReadonlyArray<readonly [TrafficChannel, string, Hit]> = [
		['direct', 'direct', { path: '/direct' }],
		[
			'organic-search',
			'google.com',
			{ path: '/organic-search', referrer: 'https://www.google.com/search?q=x' },
		],
		[
			'paid-search',
			'bing.com',
			{ path: '/paid-search', referrer: 'https://www.bing.com/', query: 'msclkid=abc' },
		],
		['organic-social', 't.co', { path: '/organic-social', referrer: 'https://t.co/abc' }],
		[
			'paid-social',
			'facebook',
			{
				path: '/paid-social',
				referrer: 'https://m.facebook.com/',
				query: 'utm_source=facebook&utm_medium=cpc',
			},
		],
		[
			'organic-video',
			'youtube.com',
			{ path: '/organic-video', referrer: 'https://www.youtube.com/watch?v=x' },
		],
		[
			'paid-video',
			'youtu.be',
			{ path: '/paid-video', referrer: 'https://youtu.be/x', query: 'utm_medium=paid-video' },
		],
		['email', 'newsletter', { path: '/email', query: 'utm_source=newsletter&utm_medium=email' }],
		[
			'affiliate',
			'partner-co',
			{ path: '/affiliate', query: 'utm_source=partner-co&utm_medium=affiliate' },
		],
		['display', 'adnet', { path: '/display', query: 'utm_source=adnet&utm_medium=banner' }],
		[
			'referral',
			'news.ycombinator.com',
			{ path: '/referral', referrer: 'https://news.ycombinator.com/item?id=1' },
		],
		[
			'paid-other',
			'ads.example',
			{ path: '/paid-other', referrer: 'https://ads.example/x', query: 'utm_medium=cpc' },
		],
	]

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		for (const [, , hit] of hits) {
			await ingestAccepted(
				booted,
				{ type: 'pageview', hostname: 'site.com', durationMs: 100, ...hit },
				{ 'user-agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 ${hit.path}` }
			)
		}
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`stores the channel beside the named origin on ${db}`, async () => {
		for (const [channel, source, hit] of hits) {
			const docs = await storedHits(booted.payload, { path: { equals: hit.path } })
			expect(docs).toHaveLength(1)
			expect(docs[0]).toMatchObject({ channel, source, channelVersion: CHANNEL_TAXONOMY_VERSION })
		}
	})

	it(`serves a breakdown per channel, and the same with a filter on it on ${db}`, async () => {
		expect(await breakdownOf(booted, adapter, 'channel')).toEqual(
			Object.fromEntries(hits.map(([channel]) => [channel, 1]))
		)
		for (const [channel] of hits) {
			const filtered = await adapter.query(
				{
					metrics: ['pageviews'],
					dimensions: ['channel'],
					dateRange: aroundNow(),
					filters: [{ dimension: 'channel', operator: 'eq', value: channel }],
				},
				{ payload: booted.payload }
			)
			expect(filtered.rows).toEqual([{ dimensions: { channel }, metrics: { pageviews: 1 } }])
		}
	})

	it(`breaks the same hits down by their named origin on ${db}`, async () => {
		const expected: Record<string, number> = {}
		for (const [, source] of hits) {
			expected[source] = (expected[source] ?? 0) + 1
		}
		expect(await breakdownOf(booted, adapter, 'source')).toEqual(expected)
	})

	it(`filters channels with contains as well as eq on ${db}`, async () => {
		const paid = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: aroundNow(),
				filters: [{ dimension: 'channel', operator: 'contains', value: 'paid-' }],
			},
			{ payload: booted.payload }
		)
		// paid-search, paid-social, paid-video and paid-other, and no organic row with them.
		expect(paid.totals).toEqual({ pageviews: 4 })
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
		booted = await bootPayload({
			// The cap guards what a trusted platform header can still carry.
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				trustedPlatform: 'vercel',
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	// A client-settable geo header keys daily totals; uncapped it breaks Postgres's 2704-byte btree
	// limit. Fixture is incompressible: Postgres compresses index values, so repeats would fit.
	it(`truncates an oversized geo header instead of failing the write on ${db}`, async () => {
		await ingestAccepted(
			booted,
			{ type: 'pageview', path: '/geo', hostname: 'site.com', durationMs: 100 },
			{ 'user-agent': 'UA', 'x-vercel-ip-city': noise(3000) }
		)

		const docs = await storedHits(booted.payload, { path: { equals: '/geo' } })
		expect(String(docs[0]?.city)).toHaveLength(MAX_GEO_LENGTH)

		const rows = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dimensions: ['city'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(rows.rows).toEqual([
			{
				dimensions: { city: noise(3000).slice(0, MAX_GEO_LENGTH) },
				metrics: { pageviews: 1, visitors: 1 },
			},
		])

		// The day's totals are keyed by the capped value too, on every database.
		const { engine, store } = nativeOf(booted.payload)
		const day = calendarDayOf(new Date(String(docs[0]?.ts)), 'UTC')
		expect(await engine.snapshot({ scope: '', day, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		const cities = await store.readAggregates({ days: [[day, day]], dim: 'city', groupBy: 'value' })
		expect(cities.map((row) => row.value)).toEqual([noise(3000).slice(0, MAX_GEO_LENGTH)])
	})
})

describeForDb('analytics per-document read', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(new Date('2026-06-15T12:00:00.000Z'))
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
		clock.reset()
	})

	const ingest = (path: string) =>
		ingestDirect(
			booted.payload,
			{ type: 'pageview', path, hostname: 'h', durationMs: 200 },
			{ 'x-vercel-ip-country': 'US' }
		)

	it(`reads per-document totals through the engine on ${db}`, async () => {
		await ingest('/matrix-doc')
		await ingest('/matrix-doc')
		const result = await readForField({
			req: readerRequest(booted.payload, { locale: undefined }),
			collectionSlug: 'pages',
			data: { slug: '/matrix-doc' },
			metrics: ['pageviews', 'visitors'],
			timeframe: 'last30days',
			now: clock.now(),
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.metrics.visitors).toBe(1)
	})
})

describeForDb('native scoped ingest and reads', {}, (db) => {
	const adapter = native({ platformHostnames: [INGEST_HOST] })
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: ({ req }) => req.user?.id === 'admin' },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	// A scoped install drops what resolves no scope, so the tenant-less case rides in on the
	// platform hostname this install declares, which is the null scope by design.
	const ingest = (tenant: string | null, path: string, ua = 'UA'): Promise<void> =>
		ingestAccepted(
			booted,
			{ type: 'pageview', path, durationMs: 100 },
			{ 'user-agent': ua, ...(tenant ? { 'x-tenant': tenant } : {}) }
		)

	const totalsIn = async (scope: string, path: string) =>
		(
			await adapter.query(
				{ scope, path, metrics: ['pageviews', 'visitors'], dateRange: aroundNow() },
				{ payload: booted.payload }
			)
		).totals

	const widgetReq = (tenant?: string, user: { id: string } = { id: 'reader' }): PayloadRequest =>
		({
			payload: booted.payload,
			headers: new Headers(tenant ? { 'x-tenant': tenant } : {}),
			user: { ...user, collection: 'users' },
		}) as unknown as PayloadRequest

	it(`stamps ingested hits with the resolved scope, and reads each scope apart on ${db}`, async () => {
		await ingest('t1', '/scoped')
		await ingest('t1', '/scoped', 'UA-second-visitor')
		await ingest('t2', '/scoped')
		await ingest(null, '/scoped')

		const scopes = (await storedHits(booted.payload, { path: { equals: '/scoped' } })).map(
			(hit) => hit.scope
		)
		expect(scopes.sort()).toEqual(['', 't1', 't1', 't2'])
		expect(await totalsIn('t1', '/scoped')).toEqual({ pageviews: 2, visitors: 2 })
		expect(await totalsIn('t2', '/scoped')).toEqual({ pageviews: 1, visitors: 1 })
		expect(await totalsIn('', '/scoped')).toEqual({ pageviews: 1, visitors: 1 })
	})

	it(`keeps the same visitor distinct per scope on ${db}`, async () => {
		await ingest('t1', '/dedupe', 'UA-shared')
		await ingest('t1', '/dedupe', 'UA-shared')
		await ingest('t2', '/dedupe', 'UA-shared')
		expect(await totalsIn('t1', '/dedupe')).toEqual({ pageviews: 2, visitors: 1 })
		expect(await totalsIn('t2', '/dedupe')).toEqual({ pageviews: 1, visitors: 1 })
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
		const runtime = getRuntime(booted.payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const denied = await resolveRequestedScope({ runtime, req: widgetReq('t1'), raw: '*' })
		expect(denied.ok).toBe(false)

		const admin = widgetReq('t1', { id: 'admin' })
		const granted = await resolveRequestedScope({ runtime, req: admin, raw: '*' })
		if (!granted.ok) {
			throw new Error('the aggregate was refused to the platform reader')
		}
		const allowed = await readForWidget({
			req: admin,
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
			scope: granted.gated,
		})
		expect(allowed.status).toBe('ok')
		expect(allowed.metrics.pageviews).toBe(7)
	})
})

describeForDb('native reporting timezone days', {}, (db) => {
	const TZ = 'America/New_York'
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' }, reportingTimezone: TZ }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`counts a hit on the reporting timezone's local day on ${db}`, async () => {
		await ingestAccepted(booted, { type: 'pageview', path: '/tz', hostname: 'h', durationMs: 100 })
		expect(await seriesDays(booted, adapter, { path: '/tz' })).toEqual([
			await hitDayStart(booted, '/tz', TZ),
		])
	})
})

describeForDb('custom range end bound', {}, (db) => {
	const TZ = 'Europe/Berlin'
	// Every raw hit read, however old: the fixture's days are further back than the default 90.
	const adapter = native({ retention: { rawDays: null } })
	let booted: BootedPayload

	// Jun 23 in Berlin ends at 2026-06-23T21:59:59.999Z, so 23:30 local is the last event
	// inside the picked window and 00:30 the next morning is the first one outside it.
	const pageview = (timestamp: string, visitorId: string): NormalizedEvent => ({
		timestamp: new Date(timestamp),
		type: 'pageview',
		path: '/cr',
		hostname: 'h',
		visitorId,
	})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' }, reportingTimezone: TZ }),
			db,
		})
		await storeEvents(booted.payload, [
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
		const req = readerRequest(booted.payload)
		const args = {
			req,
			metrics: ['pageviews' as const],
			timeframe: 'last30days' as const,
			now: new Date(),
			range,
			timezone: TZ,
		}
		// The days' aggregate rows, each counted in the reporting timezone.
		const aggregated = await readForWidget(args)
		expect(aggregated.status).toBe('ok')
		expect(aggregated.metrics.pageviews).toBe(1)
		// And raw hits, which a `contains` filter reads, where the engine compares the end instant.
		const raw = await readForWidget({
			...args,
			filters: [{ dimension: 'page', operator: 'contains', value: '/cr' }],
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
	const adapter = native({ platformHostnames: [INGEST_HOST] })
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant-id') },
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

	const ingest = (tenantId: string | null, path: string): Promise<void> =>
		ingestAccepted(
			booted,
			{ type: 'pageview', path, durationMs: 100 },
			tenantId === null ? {} : { 'x-tenant-id': tenantId }
		)

	it(`counts tenant-a hits on the ${TZ_A} local day on ${db}`, async () => {
		await ingest(TENANT_A, '/tz-a')
		expect(await seriesDays(booted, adapter, { path: '/tz-a', scope: TENANT_A })).toEqual([
			await hitDayStart(booted, '/tz-a', TZ_A),
		])
	})

	it(`counts tenant-b hits on the ${TZ_B} local day on ${db}`, async () => {
		await ingest(TENANT_B, '/tz-b')
		expect(await seriesDays(booted, adapter, { path: '/tz-b', scope: TENANT_B })).toEqual([
			await hitDayStart(booted, '/tz-b', TZ_B),
		])
	})

	it(`counts in UTC when the resolver returns null (no tenant header) on ${db}`, async () => {
		await ingest(null, '/tz-fallback')
		expect(await seriesDays(booted, adapter, { path: '/tz-fallback', scope: '' })).toEqual([
			await hitDayStart(booted, '/tz-fallback', 'UTC'),
		])
	})
})

describeForDb('reportingTimezone invalid/null/throwing → UTC fallback', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				// Answers null, and throws for a beacon that names the bad tenant.
				reportingTimezone: ({ req }) => {
					if (req.headers.get('x-tenant-id') === 'bad-scope') {
						throw new Error('simulated resolver failure')
					}
					return null
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const ingest = (tenantId: string | null, path: string): Promise<void> =>
		ingestAccepted(
			booted,
			{ type: 'pageview', path, hostname: 'h', durationMs: 100 },
			tenantId === null ? {} : { 'x-tenant-id': tenantId }
		)

	it(`counts in UTC when the resolver returns null on ${db}`, async () => {
		await ingest(null, '/tz-null')
		expect(await seriesDays(booted, adapter, { path: '/tz-null' })).toEqual([
			await hitDayStart(booted, '/tz-null', 'UTC'),
		])
	})

	it(`stores the hit, counted in UTC, when the resolver throws on ${db}`, async () => {
		await ingest('bad-scope', '/tz-throw')
		expect(await seriesDays(booted, adapter, { path: '/tz-throw' })).toEqual([
			await hitDayStart(booted, '/tz-throw', 'UTC'),
		])
	})

	// A string option is checked at boot; a resolver's answer can only be checked as it arrives.
	it(`counts in UTC when the resolver answers an invalid IANA name on ${db}`, async () => {
		const invalid = native()
		let booted2: BootedPayload | undefined
		try {
			booted2 = await bootPayload({
				plugin: analytics({
					adapters: [invalid],
					capture: { gate: 'off' },
					reportingTimezone: () => 'Not/ATimezone',
				}),
				db,
			})
			await ingestAccepted(booted2, {
				type: 'pageview',
				path: '/tz-invalid',
				hostname: 'h',
				durationMs: 100,
			})
			expect(await seriesDays(booted2, invalid, { path: '/tz-invalid' })).toEqual([
				await hitDayStart(booted2, '/tz-invalid', 'UTC'),
			])
		} finally {
			await booted2?.stop()
		}
	})
})

describeForDb('native hostname families', {}, (db) => {
	const adapter = native()
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

	const ingest = (path: string, hostname: string, ua: string) =>
		ingestDirect(
			booted.payload,
			{ type: 'pageview', path, durationMs: 100 },
			{ 'user-agent': ua, host: hostname }
		)

	const pageviewsOn = async (hostname?: string): Promise<number | null | undefined> =>
		(
			await adapter.query(
				{
					path: '/hf',
					metrics: ['pageviews'],
					dateRange: aroundNow(),
					...(hostname ? { hostname } : {}),
				},
				{ payload: booted.payload }
			)
		).totals?.pageviews

	it(`reads each hostname exactly, and every hostname together on ${db}`, async () => {
		await ingest('/hf', 'a.example', 'UA-A1')
		await ingest('/hf', 'b.example', 'UA-B1')

		expect(await pageviewsOn()).toBe(2)
		expect(await pageviewsOn('a.example')).toBe(1)
		expect(await pageviewsOn('b.example')).toBe(1)
	})
})

/** One run of the sync task as the jobs runner calls it, over the last three days. */
const runSync = async (
	booted: BootedPayload,
	scopes?: SyncTaskOptions['scopes']
): Promise<SyncTaskOutput> => {
	const { handler } = syncTask({
		schedule: DEFAULT_JOBS.sync,
		lookbackDays: 3,
		collectionSlug: SYNC_SLUG,
		...(scopes ? { scopes } : {}),
	})
	if (typeof handler !== 'function') {
		throw new Error('sync handler must be a function')
	}
	const result = await handler({
		req: { payload: booted.payload },
	} as unknown as Parameters<typeof handler>[0])
	return (result as { output: SyncTaskOutput }).output
}

interface SyncedRow {
	source: string
	scope: string
	date: string
	pageviews: number
	visitors: number
}

/** The synced rows `where` selects, read past access control. */
const syncedRows = async (booted: BootedPayload, where: Where = {}): Promise<SyncedRow[]> =>
	(
		await booted.payload.find({
			collection: SYNC_SLUG as never,
			where,
			limit: 100,
			overrideAccess: true,
		})
	).docs as unknown as SyncedRow[]

const syncedCount = async (booted: BootedPayload): Promise<number> =>
	(await booted.payload.find({ collection: SYNC_SLUG as never, limit: 0, overrideAccess: true }))
		.totalDocs

describeForDb('analytics sync tier', {}, (db) => {
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native(), mem], sync: true }), db })
		for (let offset = 0; offset < 3; offset++) {
			const t = new Date(Date.now() - offset * DAY_MS)
			mem.record({ path: '/p', timestamp: t, visitor: 'a' })
			mem.record({ path: '/p', timestamp: t, visitor: 'b' })
		}
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the analytics-daily collection and the sync task with its cron', () => {
		const config = booted.payload.config as unknown as {
			collections?: Array<{ slug?: string }>
			jobs?: { tasks?: Array<{ slug?: string; schedule?: Array<{ cron?: string }> }> }
		}
		expect((config.collections ?? []).some((c) => c.slug === SYNC_SLUG)).toBe(true)
		const task = (config.jobs?.tasks ?? []).find((t) => t.slug === SYNC_TASK_SLUG)
		expect(task?.schedule?.[0]?.cron).toBe('0 */6 * * *')
	})

	it('upserts one row per (provider source, day) and excludes native', async () => {
		const out = await runSync(booted)
		expect(out.failed).toBe(0)
		expect(out.synced).toBe(3)
		const rows = await syncedRows(booted)
		expect(rows.length).toBe(3)
		for (const row of rows) {
			expect(row.source).toBe('memory')
			expect(row.pageviews).toBe(2)
			expect(row.visitors).toBe(2)
			expect(row.date).toBeTruthy()
			expect(row.scope).toBe('')
		}
	})

	it('is idempotent: a second run updates in place with no duplicates', async () => {
		const before = await syncedCount(booted)
		await runSync(booted)
		const after = await syncedCount(booted)
		expect(after).toBe(before)
		expect(after).toBe(3)
	})
})

describeForDb('analytics sync tier: scope fan-out', {}, (db) => {
	let booted: BootedPayload
	let memRoot: MemoryAnalyticsAdapter
	let memT1: MemoryAnalyticsAdapter
	let memT2: MemoryAnalyticsAdapter
	let memShared: MemoryAnalyticsAdapter

	beforeAll(async () => {
		memRoot = { ...memoryAdapter(), id: 'memory:root' }
		memT1 = { ...memoryAdapter(), id: 'memory:t1' }
		memT2 = { ...memoryAdapter(), id: 'memory:t2' }
		// A config adapter without `scopedQueries` cannot narrow its query to one tenant, so sync
		// must pull it only for the install-wide (null) pass.
		memShared = { ...memoryAdapter(), id: 'shared' }
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native(), memShared],
				capture: { gate: 'off' },
				sync: true,
				scope: {
					member: () => true,
					resolve: ({ req }) => req.headers.get('x-tenant'),
					list: () => ['t1', 't2'],
				},
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
		const t = new Date(Date.now() - DAY_MS)
		const visit = (adapter: MemoryAnalyticsAdapter, visitors: string[]): void => {
			for (const visitor of visitors) {
				adapter.record({ path: '/p', timestamp: t, visitor })
			}
		}
		visit(memRoot, ['a', 'b'])
		visit(memT1, ['a'])
		visit(memT2, ['a', 'b', 'c'])
		visit(memShared, ['a', 'b', 'c', 'd', 'e'])
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`syncs one row per scope, each reading that scope's own resolved provider on ${db}`, async () => {
		const out = await runSync(booted, () => ['t1', 't2'])
		expect(out.failed).toBe(0)
		expect(out.synced).toBe(4)
		const byScope = new Map(
			(await syncedRows(booted)).filter((d) => d.source !== 'shared').map((d) => [d.scope, d])
		)
		expect(byScope.get('')?.pageviews).toBe(2)
		expect(byScope.get('t1')?.pageviews).toBe(1)
		expect(byScope.get('t2')?.pageviews).toBe(3)
	})

	it(`only ever syncs a shared (non-scoped) config adapter into the install-wide scope on ${db}`, async () => {
		const rows = await syncedRows(booted, { source: { equals: 'shared' } })
		expect(rows).toHaveLength(1)
		expect(rows[0]?.scope).toBe('')
		expect(rows[0]?.pageviews).toBe(5)
	})

	it(`is idempotent across scopes: a second run updates in place with no duplicates on ${db}`, async () => {
		const before = await syncedCount(booted)
		await runSync(booted, () => ['t1', 't2'])
		const after = await syncedCount(booted)
		expect(after).toBe(before)
		expect(after).toBe(4)
	})

	it(`a tenant's find with overrideAccess: false returns only their scope's rows on ${db}`, async () => {
		const { docs } = await booted.payload.find({
			collection: SYNC_SLUG as never,
			limit: 100,
			overrideAccess: false,
			user: { id: 'u1' },
			req: { headers: new Headers({ 'x-tenant': 't1' }) } as unknown as PayloadRequest,
		})
		expect(docs.length).toBeGreaterThan(0)
		expect((docs as unknown as SyncedRow[]).every((d) => d.scope === 't1')).toBe(true)
	})
})

describeForDb('analytics sync tier: per-scope resolution isolation', {}, (db) => {
	let booted: BootedPayload
	let memT2: MemoryAnalyticsAdapter

	beforeAll(async () => {
		memT2 = { ...memoryAdapter(), id: 'memory:t2' }
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				sync: true,
				scope: {
					member: () => true,
					resolve: ({ req }) => req.headers.get('x-tenant'),
					list: () => ['t1', 't2'],
				},
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
		memT2.record({ path: '/p', timestamp: new Date(Date.now() - DAY_MS), visitor: 'a' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`a registry resolution failure for one scope does not abort the others on ${db}`, async () => {
		const out = await runSync(booted, () => ['t1', 't2'])
		expect(out.failed).toBeGreaterThanOrEqual(1)
		expect(out.synced).toBeGreaterThanOrEqual(1)
		expect((await syncedRows(booted, { scope: { equals: 't2' } })).length).toBeGreaterThanOrEqual(1)
	})
})

describeForDb('form-builder action block composition', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				goals: { defaults: [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }] },
			}),
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
