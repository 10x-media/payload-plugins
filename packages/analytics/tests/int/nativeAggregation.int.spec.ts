import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import { analytics } from '../../src/index'
import { AGGREGATES_SLUG, HITS_SLUG } from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { AGGREGATION_VERSION, dayWindow } from '../../src/native/store/aggregate'
import { type CardinalityCaps, DEFAULT_CAPS } from '../../src/native/store/caps'
import { createEventStore, type EventStoreOptions } from '../../src/native/store/eventStore'
import { DAY_LEASE_MS, dayKey } from '../../src/native/store/state'
import { createStateStore } from '../../src/native/store/stateStore'
import type {
	AggregateRead,
	AggregateRun,
	EventStore,
	HitRow,
	StateStore,
} from '../../src/native/store/types'
import { at, fromGoogle, hitOf, internal } from './hitFixtures'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

const MINUTE = 60_000
const DAY = 20261006
const NEXT_DAY = 20261007

/** One clock both instances read, moved by hand so no lease waits on real time. */
const clock = { at: Date.parse('2026-10-09T12:00:00.000Z') }
const now = (): Date => new Date(clock.at)
const advance = (ms: number): void => {
	clock.at += ms
}

const v = (name: string): string => name.padEnd(16, '0')

const GERMAN_DESKTOP = { country: 'DE', device: 'desktop', browser: 'chrome', os: 'macos' }

/** A day on two hostnames: converting campaign visit, a bounce, an item click, a webhook sale. */
const dayOf = (scope: string): HitRow[] => [
	hitOf(scope, {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('V1'),
		...fromGoogle('spring'),
		...GERMAN_DESKTOP,
	}),
	hitOf(scope, {
		ts: at('2026-10-06T10:00:00.015Z'),
		lastAt: at('2026-10-06T10:04:00.000Z'),
		v: v('V1'),
		type: 'engagement',
		durationMs: 240_000,
		scrollDepth: 50,
		impressions: ['offers:1', 'offers:2'],
	}),
	hitOf(scope, {
		ts: at('2026-10-06T10:05:00.000Z'),
		v: v('V1'),
		...internal,
		...GERMAN_DESKTOP,
		path: '/pricing',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T10:06:00.000Z'),
		v: v('V1'),
		...internal,
		...GERMAN_DESKTOP,
		type: 'event',
		name: 'signup',
		path: '/pricing',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T10:07:00.000Z'),
		v: v('V1'),
		...internal,
		...GERMAN_DESKTOP,
		type: 'goal',
		name: 'purchase',
		path: '/checkout',
		value: 20,
		currency: 'EUR',
		conversions: 1,
		revenue: 20,
		goals: [{ slug: 'purchase', value: 20 }],
		item: 'offers:1',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T11:00:00.000Z'),
		v: v('V2'),
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
		country: 'US',
		device: 'mobile',
		path: '/blog',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T11:00:00.010Z'),
		lastAt: at('2026-10-06T11:01:00.000Z'),
		v: v('V2'),
		type: 'engagement',
		path: '/blog',
		durationMs: 60_000,
		impressions: ['offers:2'],
	}),
	hitOf(scope, {
		ts: at('2026-10-06T12:00:00.000Z'),
		v: v('V3'),
		landing: true,
		source: 'direct',
		channel: 'direct',
		country: 'FR',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T12:01:00.000Z'),
		v: v('V3'),
		...internal,
		country: 'FR',
		type: 'event',
		name: 'item_click',
		item: 'offers:2',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T13:00:00.000Z'),
		v: '',
		type: 'goal',
		name: 'purchase',
		server: true,
		path: '/api/webhook',
		value: 5,
		currency: 'EUR',
		conversions: 1,
		revenue: 5,
		goals: [{ slug: 'purchase', value: 5 }],
		item: 'offers:1',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T09:00:00.000Z'),
		hostname: 'b.example',
		v: v('V4'),
		...fromGoogle(),
		country: 'DE',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T09:10:00.000Z'),
		hostname: 'b.example',
		v: v('V4'),
		...internal,
		country: 'DE',
		path: '/docs',
	}),
	hitOf(scope, {
		ts: at('2026-10-06T15:00:00.000Z'),
		hostname: 'b.example',
		v: v('V5'),
		landing: true,
		ref: 'news.example',
		source: 'news.example',
		channel: 'referral',
		country: 'DE',
		device: 'mobile',
		path: '/news',
	}),
	hitOf(scope, { ts: at('2026-10-07T10:00:00.000Z'), v: v('V6'), ...fromGoogle() }),
	hitOf(scope, {
		ts: at('2026-10-07T11:00:00.000Z'),
		v: v('V7'),
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
		path: '/pricing',
	}),
]

/** Six pages with a pageview count each, one visitor per pageview, for the caps to cut. */
const cappedDay = (scope: string): HitRow[] =>
	(
		[
			['/p1', 6],
			['/p2', 5],
			['/p3', 4],
			['/p4', 3],
			['/p5', 3],
			['/p6', 1],
		] as const
	).flatMap(([path, count], page) =>
		Array.from({ length: count }, (_, i) =>
			hitOf(scope, {
				ts: at(`2026-10-06T1${page}:0${i}:00.000Z`),
				v: v(`C${page}x${i}`),
				...(i % 2 === 0 ? fromGoogle() : internal),
				path,
				durationMs: 1000,
			})
		)
	)

/** Seven hundred pages, one pageview each: more rows than one write chunk holds. */
const wideDay = (scope: string): HitRow[] =>
	Array.from({ length: 700 }, (_, i) =>
		hitOf(scope, {
			ts: new Date(Date.parse('2026-10-06T08:00:00.000Z') + i * 1000),
			v: v(`W${i}`),
			...fromGoogle(),
			path: `/wide/${i}`,
		})
	)

const SCOPES = ['agg', 'race', 'stale', 'late', 'crash', 'stray']

const HITS: HitRow[] = [
	...SCOPES.flatMap(dayOf),
	...dayOf('sweep'),
	...cappedDay('caps'),
	...wideDay('wide'),
	...wideDay('wide-new'),
]

interface StoredRow {
	hostname: string
	dim: string
	value: string
	dim2: string
	value2: string
	gen: string
	parts: Record<string, unknown>
}

const PART_FIELDS = [
	'pageviews',
	'events',
	'visitors',
	'sessions',
	'entries',
	'bounces',
	'sessionMs',
	'durationMs',
	'scrollSum',
	'scrollSamples',
	'conversions',
	'revenue',
	'impressions',
	'interactions',
] as const

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A day's aggregate rows as Payload's own adapter reads them back, every generation included. */
const storedRows = async (payload: Payload, scope: string, day: number): Promise<StoredRow[]> => {
	const { docs } = await payload.db.find({
		collection: AGGREGATES_SLUG,
		where: { and: [{ scope: { equals: scope } }, { day: { equals: day } }] },
		pagination: false,
		req: {},
	})
	return docs
		.map((doc): unknown => ({ ...doc }))
		.filter(isRecord)
		.map(
			(doc): StoredRow => ({
				hostname: text(doc.hostname),
				dim: text(doc.dim),
				value: text(doc.value),
				dim2: text(doc.dim2),
				value2: text(doc.value2),
				gen: text(doc.gen),
				parts: Object.fromEntries(PART_FIELDS.map((part) => [part, doc[part] ?? null])),
			})
		)
		.sort((a, b) =>
			JSON.stringify([a.hostname, a.dim, a.value, a.dim2, a.value2]) <
			JSON.stringify([b.hostname, b.dim, b.value, b.dim2, b.value2])
				? -1
				: 1
		)
}

const withoutGen = (rows: readonly StoredRow[]) =>
	rows.map((row) => [row.hostname, row.dim, row.value, row.dim2, row.value2, row.parts])

describeForDb('engine day aggregation', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload
	let a: EventStore
	let b: EventStore
	let stateA: StateStore
	let stateB: StateStore

	const storeOn = (booted: BootedPayload, options: EventStoreOptions = {}): EventStore =>
		createEventStore(booted.payload, { now, ...options })

	const runOf = (runId: string, caps: CardinalityCaps = DEFAULT_CAPS): AggregateRun => ({
		runId,
		caps,
		status: 'provisional',
	})

	/** Claims a day for `runId` and aggregates it, as the maintenance run does. */
	const aggregate = async (
		on: { store: EventStore; state: StateStore },
		scope: string,
		run: AggregateRun
	) => {
		await on.state.ensureMarkers([{ scope, day: DAY, tz: 'UTC' }])
		expect(await on.state.claim(dayKey(scope, DAY), run.runId, DAY_LEASE_MS)).toBe(true)
		return on.store.aggregateDay(dayWindow(scope, DAY, 'UTC'), run)
	}

	const total = (scope: string, more: Partial<AggregateRead> = {}) =>
		a.readAggregates({ scope, days: [[DAY, DAY]], dim: '', groupBy: 'total', ...more })

	const markerOf = async (scope: string) => (await stateA.markers(scope, DAY, DAY))[0]

	beforeAll(async () => {
		first = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: first })
		a = storeOn(first)
		b = storeOn(second)
		stateA = createStateStore(first.payload, { now })
		stateB = createStateStore(second.payload, { now })
		expect(await a.append(HITS)).toEqual({ written: HITS.length, duplicates: 0 })
	}, 240_000)

	afterAll(async () => {
		await second?.stop()
		await first?.stop()
	})

	beforeEach(() => {
		advance(DAY_LEASE_MS * 2)
	})

	it('writes every kind of row of a day, and reads them back as the raw hits count them', async () => {
		const result = await aggregate({ store: a, state: stateA }, 'agg', runOf('agg-1'))
		expect(result).toMatchObject({ completed: true, hits: 13 })
		expect(result.rows).toBe((await storedRows(first.payload, 'agg', DAY)).length)
		const [site] = await total('agg', { hostname: 'a.example' })
		expect(site?.parts).toEqual({
			pageviews: 4,
			events: 4,
			visitors: 3,
			sessions: 3,
			entries: 3,
			bounces: 1,
			sessionMs: 300_000,
			durationMs: 300_000,
			scrollSum: 50,
			scrollSamples: 0,
			conversions: 2,
			revenue: 25,
			impressions: null,
			interactions: 1,
		})
		const window = {
			scope: 'agg',
			start: at('2026-10-06T00:00:00.000Z'),
			end: at('2026-10-07T00:00:00.000Z'),
			filters: [],
			sessions: true,
			timeoutMs: 20_000,
		}
		expect(await total('agg')).toEqual(await a.readRaw(window))
		const kinds = new Set(
			(await storedRows(first.payload, 'agg', DAY)).map((row) => `${row.dim}:${row.dim2}`)
		)
		expect([...kinds].sort()).toEqual(
			[
				':',
				'browser:',
				'channel:',
				'country:',
				'currency:',
				'device:',
				'event:',
				'goal:',
				'goal:channel',
				'goal:source',
				'goal:utmCampaign',
				'item:',
				'item:page',
				'os:',
				'page:',
				'referrer:',
				'source:',
				'utmCampaign:',
				'utmSource:',
			].sort()
		)
		const itemPages = await a.readAggregates({
			scope: 'agg',
			days: [[DAY, DAY]],
			dim: 'item',
			value: 'offers:1',
			dim2: 'page',
			groupBy: 'value2',
		})
		// The webhook's sale names the item too, but a server hit was on no page anyone saw.
		expect(itemPages.map((row) => [row.value, row.parts.impressions])).toEqual([
			['/', 1],
			['/checkout', 0],
		])
	})

	it('writes the same rows again on a rewrite, from either instance, and keeps one generation', async () => {
		await aggregate({ store: a, state: stateA }, 'agg', runOf('agg-2'))
		const once = await storedRows(first.payload, 'agg', DAY)
		const result = await aggregate({ store: b, state: stateB }, 'agg', runOf('agg-3'))
		expect(result).toMatchObject({ completed: true, rows: once.length })
		const twice = await storedRows(second.payload, 'agg', DAY)
		expect(withoutGen(twice)).toEqual(withoutGen(once))
		const marker = await markerOf('agg')
		expect(new Set(twice.map((row) => row.gen))).toEqual(new Set([marker?.gen]))
		expect(marker).toMatchObject({
			status: 'provisional',
			hits: 13,
			version: AGGREGATION_VERSION,
			leaseOwner: null,
		})
	})

	it('drops on a rewrite the values whose hits are gone', async () => {
		const on = { store: a, state: stateA }
		await aggregate(on, 'sweep', runOf('sweep-1'))
		const bySource = () =>
			a.readAggregates({ scope: 'sweep', days: [[DAY, DAY]], dim: 'source', groupBy: 'value' })
		expect((await bySource()).map((row) => row.value)).toEqual([
			'bing',
			'direct',
			'google',
			'news.example',
		])
		await first.payload.db.deleteMany({
			collection: HITS_SLUG,
			where: { and: [{ scope: { equals: 'sweep' } }, { v: { equals: v('V2') } }] },
			req: {},
		})
		await stateA.markDirty('sweep', [DAY])
		advance(DAY_LEASE_MS * 2)
		await aggregate(on, 'sweep', runOf('sweep-2'))
		expect((await bySource()).map((row) => row.value)).toEqual(['direct', 'google', 'news.example'])
		const stored = await storedRows(first.payload, 'sweep', DAY)
		expect(stored.filter((row) => row.value === 'bing' || row.value === '/blog')).toEqual([])
		expect(stored.filter((row) => row.dim === 'item' && row.value === 'offers:2')).toHaveLength(2)
	})

	it('folds the values past a cap into one (other) row, which totals count and no ranking lists', async () => {
		const result = await aggregate(
			{ store: a, state: stateA },
			'caps',
			runOf('caps-1', { ...DEFAULT_CAPS, page: 3, source: 1 })
		)
		expect(result.completed).toBe(true)
		const read = (dim: 'page' | 'source', groupBy: 'value' | 'total') =>
			a.readAggregates({ scope: 'caps', days: [[DAY, DAY]], dim, groupBy })
		const pages = await read('page', 'value')
		expect(pages.map((row) => [row.value, row.parts.pageviews, row.parts.visitors])).toEqual([
			['/p1', 6, 6],
			['/p2', 5, 5],
			['/p3', 4, 4],
		])
		const stored = await storedRows(first.payload, 'caps', DAY)
		const other = stored.find((row) => row.dim === 'page' && row.value === '')
		expect(other?.parts).toMatchObject({
			pageviews: 7,
			visitors: null,
			sessions: null,
			sessionMs: null,
			entries: 7,
			durationMs: 7000,
		})
		const [site] = await total('caps')
		const [allPages] = await read('page', 'total')
		expect(allPages?.parts.pageviews).toBe(site?.parts.pageviews)
		const sources = await read('source', 'value')
		expect(sources.map((row) => [row.value, row.parts.pageviews, row.parts.sessions])).toEqual([
			['google', 13, 13],
		])
		const [allSources] = await read('source', 'total')
		expect(allSources?.parts.pageviews).toBe(22)
	})

	it('lets one of two instances aggregate a day, and the other writes nothing', async () => {
		await stateA.ensureMarkers([{ scope: 'race', day: DAY, tz: 'UTC' }])
		const key = dayKey('race', DAY)
		const claims = await Promise.all([
			stateA.claim(key, 'race-a', DAY_LEASE_MS),
			stateB.claim(key, 'race-b', DAY_LEASE_MS),
		])
		expect(claims.filter(Boolean)).toHaveLength(1)
		const [fromA, fromB] = await Promise.all([
			a.aggregateDay(dayWindow('race', DAY, 'UTC'), runOf('race-a')),
			b.aggregateDay(dayWindow('race', DAY, 'UTC'), runOf('race-b')),
		])
		const [won, lost] = claims[0] ? [fromA, fromB] : [fromB, fromA]
		expect(won).toMatchObject({ completed: true, hits: 13 })
		expect(lost).toEqual({ completed: false, hits: 0, rows: 0 })
		const stored = await storedRows(first.payload, 'race', DAY)
		expect(stored).toHaveLength(won?.rows ?? -1)
		expect(new Set(stored.map((row) => row.gen))).toEqual(new Set([(await markerOf('race'))?.gen]))
	})

	it('refuses a run whose lease passed to another run before it wrote', async () => {
		const late = storeOn(first, {
			hooks: {
				beforeWrite: async () => {
					advance(DAY_LEASE_MS + MINUTE)
					expect(await stateB.claim(dayKey('stale', DAY), 'stale-b', DAY_LEASE_MS)).toBe(true)
				},
			},
		})
		const result = await aggregate({ store: late, state: stateA }, 'stale', runOf('stale-a'))
		expect(result).toMatchObject({ completed: false, hits: 13, rows: 0 })
		expect(await storedRows(first.payload, 'stale', DAY)).toEqual([])
		expect(await markerOf('stale')).toMatchObject({ leaseOwner: 'stale-b', gen: null })
		const taken = await b.aggregateDay(dayWindow('stale', DAY, 'UTC'), runOf('stale-b'))
		expect(taken).toMatchObject({ completed: true, hits: 13 })
		expect((await total('stale'))[0]?.parts.pageviews).toBe(7)
	})

	it('refuses at completion a run whose lease passed mid-write, and drops what it wrote', async () => {
		let writtenBeforeTakeover = 0
		const late = storeOn(first, {
			hooks: {
				afterChunk: async () => {
					writtenBeforeTakeover = (await storedRows(first.payload, 'late', DAY)).length
					advance(DAY_LEASE_MS + MINUTE)
					expect(await stateB.claim(dayKey('late', DAY), 'late-b', DAY_LEASE_MS)).toBe(true)
				},
			},
		})
		const result = await aggregate({ store: late, state: stateA }, 'late', runOf('late-a'))
		expect(result).toMatchObject({ completed: false, rows: 0 })
		expect(writtenBeforeTakeover).toBeGreaterThan(0)
		expect(await storedRows(first.payload, 'late', DAY)).toEqual([])
		expect(await markerOf('late')).toMatchObject({ leaseOwner: 'late-b', gen: null })
		expect(await total('late')).toEqual([
			{ value: null, parts: expect.objectContaining({ pageviews: 0, visitors: 0 }) },
		])
	})

	it('leaves a day exactly as it was readable when a rewrite fails midway', async () => {
		const failedAfter: number[] = []
		const failing = (scope: string) =>
			storeOn(first, {
				hooks: {
					afterChunk: async (written) => {
						failedAfter.push(written)
						throw new Error(`${scope} lost its database midway`)
					},
				},
			})
		await aggregate({ store: a, state: stateA }, 'wide', runOf('wide-1'))
		const before = await a.readAggregates({
			scope: 'wide',
			days: [[DAY, DAY]],
			dim: 'page',
			groupBy: 'value',
		})
		const done = await markerOf('wide')
		expect(before).toHaveLength(700)
		await expect(
			aggregate({ store: failing('wide'), state: stateA }, 'wide', runOf('wide-2'))
		).rejects.toThrow('wide lost its database midway')
		expect(
			await a.readAggregates({ scope: 'wide', days: [[DAY, DAY]], dim: 'page', groupBy: 'value' })
		).toEqual(before)
		expect((await markerOf('wide'))?.gen).toBe(done?.gen)
		const stored = await storedRows(first.payload, 'wide', DAY)
		expect(new Set(stored.map((row) => row.gen))).toEqual(new Set([done?.gen]))

		await expect(
			aggregate({ store: failing('wide-new'), state: stateA }, 'wide-new', runOf('wide-new-1'))
		).rejects.toThrow('wide-new lost its database midway')
		expect(await storedRows(first.payload, 'wide-new', DAY)).toEqual([])
		expect((await total('wide-new'))[0]?.parts).toMatchObject({ pageviews: 0, visitors: 0 })
		expect(await markerOf('wide-new')).toMatchObject({ gen: null, status: 'open' })
		// Each run failed with one full chunk of its rows already written.
		expect(failedAfter).toEqual([500, 500])
	})

	it('reads no row of a generation its day marker does not name, and a rewrite deletes it', async () => {
		await aggregate({ store: a, state: stateA }, 'stray', runOf('stray-1'))
		await first.payload.db.create({
			collection: AGGREGATES_SLUG,
			data: {
				id: 'stray-row',
				scope: 'stray',
				day: DAY,
				hostname: 'a.example',
				dim: 'page',
				value: '/stray',
				dim2: '',
				value2: '',
				gen: 'never-completed',
				pageviews: 1000,
				events: 0,
			},
			req: {},
		})
		const pages = () =>
			a.readAggregates({ scope: 'stray', days: [[DAY, DAY]], dim: 'page', groupBy: 'value' })
		expect((await pages()).map((row) => row.value)).not.toContain('/stray')
		expect((await storedRows(first.payload, 'stray', DAY)).map((row) => row.value)).toContain(
			'/stray'
		)
		await aggregate({ store: a, state: stateA }, 'stray', runOf('stray-2'))
		expect((await storedRows(first.payload, 'stray', DAY)).map((row) => row.value)).not.toContain(
			'/stray'
		)
	})

	it('sums completed days: daily visitors added up, hostnames, rankings and exact fills', async () => {
		const on = { store: a, state: stateA }
		await on.state.ensureMarkers([{ scope: 'agg', day: NEXT_DAY, tz: 'UTC' }])
		expect(await on.state.claim(dayKey('agg', NEXT_DAY), 'agg-next', DAY_LEASE_MS)).toBe(true)
		await a.aggregateDay(dayWindow('agg', NEXT_DAY, 'UTC'), runOf('agg-next'))
		await aggregate(on, 'agg', runOf('agg-4'))
		const both = { scope: 'agg', days: [[DAY, NEXT_DAY]] as const, dim: '' as const }
		const series = await a.readAggregates({ ...both, groupBy: 'day' })
		expect(series.map((row) => [row.day, row.parts.visitors, row.parts.pageviews])).toEqual([
			[DAY, 5, 7],
			[NEXT_DAY, 2, 2],
		])
		const [sum] = await a.readAggregates({ ...both, groupBy: 'total' })
		expect(sum?.parts.visitors).toBe(7)
		expect(
			(await a.readAggregates({ ...both, groupBy: 'total', hostname: 'b.example' }))[0]?.parts
				.visitors
		).toBe(2)
		const top = await a.readAggregates({
			...both,
			dim: 'page',
			groupBy: 'value',
			order: { part: 'pageviews', dir: 'desc' },
			limit: 2,
		})
		expect(top.map((row) => [row.value, row.parts.pageviews])).toEqual([
			['/', 4],
			['/pricing', 2],
		])
		const filled = await a.readAggregates({
			...both,
			dim: 'source',
			groupBy: 'value',
			values: ['bing', 'nowhere'],
		})
		expect(filled.map((row) => [row.value, row.parts.sessions])).toEqual([['bing', 2]])
		const goal = await a.readAggregates({
			...both,
			dim: 'goal',
			value: 'purchase',
			dim2: 'utmCampaign',
			groupBy: 'value2',
		})
		expect(goal.map((row) => [row.value, row.parts.conversions, row.parts.revenue])).toEqual([
			['spring', 1, 20],
		])
		expect(await a.readAggregates({ ...both, groupBy: 'value', dim: 'page', values: [] })).toEqual(
			[]
		)
		await expect(a.readAggregates({ ...both, groupBy: 'value2', dim: 'page' })).rejects.toThrow(
			/only a pair/
		)
	})

	describe('refusals', () => {
		it('refuses a window that is not its day in its zone', async () => {
			await expect(
				a.aggregateDay({ ...dayWindow('agg', DAY, 'UTC'), tz: 'Europe/Berlin' }, runOf('agg-zone'))
			).rejects.toThrow(/runs from/)
		})

		it('writes nothing for a run that never claimed the day', async () => {
			expect(await a.aggregateDay(dayWindow('agg', DAY, 'UTC'), runOf('nobody'))).toEqual({
				completed: false,
				hits: 0,
				rows: 0,
			})
		})
	})
})
