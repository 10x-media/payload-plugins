import { appendFileSync } from 'node:fs'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supportsFilter } from '../../src/core/capabilities'
import type { AnalyticsFilter } from '../../src/core/contract'
import { UnsupportedFilterError } from '../../src/core/sourceErrors'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { createEventStore } from '../../src/native/store/eventStore'
import { memoryEventStore } from '../../src/native/store/memory/memoryStore'
import type { MetricParts } from '../../src/native/store/parts'
import type { EventStore, HitRow, RawRead, RawRow } from '../../src/native/store/types'
import { at, fromGoogle, hitOf, internal, randomFixture } from './hitFixtures'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

const TIMEOUT = 20_000

const read = (scope: string, start: string, end: string): RawRead => ({
	scope,
	start: at(start),
	end: at(end),
	filters: [],
	sessions: true,
	timeoutMs: TIMEOUT,
})

/** The parts a test names, from each row of a read. */
const partsOf = (
	rows: readonly RawRow[],
	keys: ReadonlyArray<keyof MetricParts>
): Array<Record<string, string | number | null>> =>
	rows.map((row) => ({
		value: row.value,
		...Object.fromEntries(keys.map((key) => [key, row.parts[key]])),
	}))

const v = (name: string): string => name.padEnd(16, '0')

const gap: HitRow[] = [
	hitOf('gap', { ts: at('2026-10-06T10:00:00.000Z'), v: v('VGAP'), ...fromGoogle() }),
	hitOf('gap', { ts: at('2026-10-06T10:20:00.000Z'), v: v('VGAP'), ...internal, path: '/pricing' }),
	hitOf('gap', { ts: at('2026-10-06T10:51:00.000Z'), v: v('VGAP'), ...internal, path: '/docs' }),
	hitOf('gap', { ts: at('2026-10-06T11:21:00.000Z'), v: v('VGAP'), ...internal }),
]

const engaged: HitRow[] = [
	hitOf('engaged', {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('VENG1'),
		...fromGoogle(),
		path: '/article',
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T10:00:00.015Z'),
		lastAt: at('2026-10-06T10:40:00.000Z'),
		v: v('VENG1'),
		type: 'engagement',
		path: '/article',
		durationMs: 2_400_000,
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T10:55:00.000Z'),
		v: v('VENG1'),
		...internal,
		path: '/next',
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('VENG2'),
		...fromGoogle(),
		path: '/article',
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T10:55:00.000Z'),
		v: v('VENG2'),
		...internal,
		path: '/next',
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T11:00:00.000Z'),
		lastAt: at('2026-10-06T11:20:00.000Z'),
		v: v('VENG3'),
		type: 'engagement',
		path: '/x',
		durationMs: 1_200_000,
	}),
	hitOf('engaged', {
		ts: at('2026-10-06T11:00:00.020Z'),
		v: v('VENG3'),
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
		path: '/x',
	}),
	hitOf('engaged', { ts: at('2026-10-06T11:45:00.000Z'), v: v('VENG3'), ...internal, path: '/y' }),
]

const carry: HitRow[] = [
	hitOf('carry', { ts: at('2026-10-06T09:00:00.000Z'), v: v('VCARRY'), ...fromGoogle('spring') }),
	hitOf('carry', { ts: at('2026-10-06T09:10:00.000Z'), v: v('VCARRY'), ...internal, path: '/a' }),
	hitOf('carry', { ts: at('2026-10-06T10:00:00.000Z'), v: v('VCARRY'), ...internal, path: '/b' }),
	hitOf('carry', {
		ts: at('2026-10-06T12:00:00.000Z'),
		v: v('VCARRY'),
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
	}),
	hitOf('carry', { ts: at('2026-10-06T13:00:00.000Z'), v: v('VCARRY'), ...internal, path: '/c' }),
]

const midnight: HitRow[] = [
	hitOf('midnight', { ts: at('2026-10-06T23:50:00.000Z'), v: v('VDAY1'), ...fromGoogle() }),
	hitOf('midnight', { ts: at('2026-10-07T00:05:00.000Z'), v: v('VDAY2'), ...internal, path: '/a' }),
]

const bounce: HitRow[] = [
	hitOf('bounce', { ts: at('2026-10-06T10:00:00.000Z'), v: v('VB1'), ...fromGoogle() }),
	hitOf('bounce', {
		ts: at('2026-10-06T10:00:00.010Z'),
		lastAt: at('2026-10-06T10:01:00.000Z'),
		v: v('VB1'),
		type: 'engagement',
		durationMs: 30_000,
		scrollDepth: 40,
	}),
	hitOf('bounce', { ts: at('2026-10-06T10:00:00.000Z'), v: v('VB2'), ...fromGoogle() }),
	hitOf('bounce', {
		ts: at('2026-10-06T10:02:00.000Z'),
		v: v('VB2'),
		...internal,
		type: 'event',
		name: 'signup',
	}),
	hitOf('bounce', { ts: at('2026-10-06T10:00:00.000Z'), v: v('VB3'), ...fromGoogle() }),
	hitOf('bounce', { ts: at('2026-10-06T10:03:00.000Z'), v: v('VB3'), ...internal, path: '/a' }),
	hitOf('bounce', {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('VB4'),
		...internal,
		type: 'event',
		name: 'signup',
		path: '/x',
	}),
]

const anon: HitRow[] = [
	hitOf('anon', {
		ts: at('2026-10-06T10:00:00.000Z'),
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
	}),
	hitOf('anon', { ts: at('2026-10-06T10:05:00.000Z'), v: v('VANON'), ...fromGoogle() }),
]

const DE_DESKTOP = { country: 'DE', device: 'desktop' }
const filters: HitRow[] = [
	hitOf('filters', {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('VF1'),
		...DE_DESKTOP,
		...fromGoogle(),
	}),
	hitOf('filters', {
		ts: at('2026-10-06T10:05:00.000Z'),
		v: v('VF1'),
		...DE_DESKTOP,
		...internal,
		path: '/pricing',
	}),
	hitOf('filters', {
		ts: at('2026-10-06T10:06:00.000Z'),
		v: v('VF1'),
		...DE_DESKTOP,
		...internal,
		type: 'event',
		name: 'signup',
		path: '/pricing',
	}),
	hitOf('filters', {
		ts: at('2026-10-06T10:00:00.000Z'),
		v: v('VF2'),
		country: 'US',
		device: 'mobile',
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
		path: '/pricing',
	}),
	hitOf('filters', {
		ts: at('2026-10-06T10:10:00.000Z'),
		v: v('VF2'),
		country: 'US',
		device: 'mobile',
		...internal,
		path: '/docs',
	}),
	hitOf('filters', {
		ts: at('2026-10-06T11:00:00.000Z'),
		v: v('VF3'),
		country: 'DE',
		device: 'mobile',
		...fromGoogle(),
		path: '/docs',
	}),
]

const contains: HitRow[] = ['/sale_50%', '/sale-50x', '/SALE_50%/x', '/blog'].map((path, i) =>
	hitOf('contains', {
		ts: at(`2026-10-06T10:0${i}:00.000Z`),
		v: v(`VC${i}`),
		...fromGoogle(),
		path,
	})
)

const topCounts: Array<[string, number]> = [
	['/a', 5],
	['/b', 4],
	['/c', 3],
	['/d', 2],
	['/e', 1],
	['/f', 2],
]
const topn: HitRow[] = topCounts.flatMap(([path, count], page) =>
	Array.from({ length: count }, (_, i) =>
		hitOf('topn', {
			ts: at(`2026-10-06T1${page}:0${i}:00.000Z`),
			v: v(`VT${page}`),
			...(i === 0 ? fromGoogle() : internal),
			path,
			...(i === 0 ? {} : { durationMs: (page + 1) * 1000 }),
		})
	)
)

const live: HitRow[] = [
	hitOf('live', {
		ts: at('2026-10-06T09:50:00.000Z'),
		v: v('VL3'),
		landing: true,
		ref: 'news.example',
		source: 'news.example',
		channel: 'referral',
		path: '/a',
	}),
	hitOf('live', { ts: at('2026-10-06T10:01:10.000Z'), v: v('VL1'), ...fromGoogle(), path: '/a' }),
	hitOf('live', {
		ts: at('2026-10-06T10:01:10.015Z'),
		lastAt: at('2026-10-06T10:09:00.000Z'),
		v: v('VL1'),
		type: 'engagement',
		path: '/a',
		durationMs: 60_000,
	}),
	hitOf('live', {
		ts: at('2026-10-06T10:02:30.000Z'),
		v: v('VL2'),
		landing: true,
		ref: 'bing.com',
		source: 'bing',
		channel: 'organic-search',
		path: '/b',
	}),
	hitOf('live', { ts: at('2026-10-06T10:15:00.000Z'), v: v('VL1'), ...internal, path: '/b' }),
	hitOf('live', {
		ts: at('2026-10-06T10:20:00.000Z'),
		v: v('VL3'),
		...internal,
		type: 'event',
		name: 'signup',
		path: '/a',
	}),
	hitOf('live', { ts: at('2026-10-06T10:40:00.000Z'), v: v('VL4'), ...fromGoogle() }),
]

const PARITY = [
	{ seed: 20261007, scope: 'parity', ...randomFixture(20261007, 'parity', 'parity-other') },
	{ seed: 5, scope: 'parity-b', ...randomFixture(5, 'parity-b', 'parity-b-other') },
]

const ALL = [
	...gap,
	...engaged,
	...carry,
	...midnight,
	...bounce,
	...anon,
	...filters,
	...contains,
	...topn,
	...live,
	...PARITY.flatMap((fixture) => fixture.hits),
]

const hours = (from: Date): Date[] =>
	Array.from({ length: 24 }, (_, i) => new Date(from.getTime() + i * 3_600_000))

/** A battery of reads over a random fixture: totals, series, every dimension, filters, ranks. */
const battery = (parity: { scope: string; days: Date[] }): Array<[string, RawRead]> => {
	const day = (index: number): Date => {
		const start = parity.days[index]
		if (!start) {
			throw new Error(`the fixture has no day ${index}`)
		}
		return start
	}
	const whole = { scope: parity.scope, start: day(0), end: day(4), filters: [], timeoutMs: TIMEOUT }
	const filtered = (...list: AnalyticsFilter[]): RawRead => ({
		...whole,
		sessions: true,
		filters: list,
	})
	const dimensions = [
		'page',
		'event',
		'goal',
		'currency',
		'item',
		'referrer',
		'source',
		'channel',
		'utmSource',
		'utmMedium',
		'utmCampaign',
		'utmContent',
		'utmTerm',
		'country',
		'region',
		'city',
		'language',
		'device',
		'browser',
		'os',
	] as const
	return [
		['total, hits only', { ...whole, sessions: false }],
		['total, with visits', { ...whole, sessions: true }],
		['total on one hostname', { ...whole, sessions: true, hostname: 'b.example' }],
		['total on one page', { ...whole, sessions: true, path: '/pricing' }],
		['every scope', { ...whole, scope: undefined, sessions: true }],
		['day series', { ...whole, sessions: true, buckets: parity.days.slice(0, 4) }],
		['day series, hits only', { ...whole, sessions: false, buckets: parity.days.slice(0, 4) }],
		[
			'hour series of one day, visits cut from its start',
			{ ...whole, start: day(1), end: day(2), sessions: true, buckets: hours(day(1)) },
		],
		[
			'part of a day, visits cut from its midnight',
			{
				...whole,
				start: new Date(day(1).getTime() + 6 * 3_600_000),
				end: new Date(day(1).getTime() + 18 * 3_600_000),
				from: day(1),
				sessions: true,
			},
		],
		[
			'part of a day, by source, visits cut from its midnight',
			{
				...whole,
				start: new Date(day(2).getTime() + 9 * 3_600_000),
				end: day(3),
				from: day(2),
				sessions: true,
				groupBy: 'source',
			},
		],
		...dimensions.map((dimension): [string, RawRead] => [
			`by ${dimension}`,
			{ ...whole, sessions: true, groupBy: dimension },
		]),
		[
			'pages by visitors, top 3',
			{
				...whole,
				sessions: false,
				groupBy: 'page',
				order: { part: 'visitors', dir: 'desc' },
				limit: 3,
			},
		],
		[
			'pages by time per pageview, top 4',
			{
				...whole,
				sessions: false,
				groupBy: 'page',
				order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
				limit: 4,
			},
		],
		[
			'sources by bounce rate, lowest first',
			{
				...whole,
				sessions: true,
				groupBy: 'source',
				order: { part: 'bounces', per: 'entries', dir: 'asc' },
			},
		],
		[
			'pages filled in exactly',
			{ ...whole, sessions: true, groupBy: 'page', values: ['/pricing', '/über', '/missing'] },
		],
		[
			'pages by source, by day',
			{
				...whole,
				sessions: true,
				groupBy: 'page',
				buckets: parity.days.slice(0, 4),
				filters: [{ dimension: 'source', operator: 'eq', value: 'google' }],
			},
		],
		['page is /pricing', filtered({ dimension: 'page', operator: 'eq', value: '/pricing' })],
		['page contains BLOG', filtered({ dimension: 'page', operator: 'contains', value: 'BLOG' })],
		['page contains _50%', filtered({ dimension: 'page', operator: 'contains', value: '_50%' })],
		[
			'German desktops',
			filtered(
				{ dimension: 'country', operator: 'eq', value: 'DE' },
				{ dimension: 'device', operator: 'eq', value: 'desktop' }
			),
		],
		[
			'source is google, by page',
			{ ...filtered({ dimension: 'source', operator: 'eq', value: 'google' }), groupBy: 'page' },
		],
		[
			'campaign contains FALL',
			filtered({ dimension: 'utmCampaign', operator: 'contains', value: 'FALL' }),
		],
		[
			'event signup, by country',
			{ ...filtered({ dimension: 'event', operator: 'eq', value: 'signup' }), groupBy: 'country' },
		],
		[
			'goal purchase, by channel',
			{ ...filtered({ dimension: 'goal', operator: 'eq', value: 'purchase' }), groupBy: 'channel' },
		],
		[
			'goal purchase, by utm campaign',
			{
				...filtered({ dimension: 'goal', operator: 'eq', value: 'purchase' }),
				groupBy: 'utmCampaign',
			},
		],
		['currency EUR', filtered({ dimension: 'currency', operator: 'eq', value: 'EUR' })],
		[
			'item offers:1 by page',
			{ ...filtered({ dimension: 'item', operator: 'eq', value: 'offers:1' }), groupBy: 'page' },
		],
		['one item, total', { ...whole, sessions: false, item: 'offers:2' }],
		[
			'one item, by day',
			{ ...whole, sessions: false, item: 'offers:2', buckets: parity.days.slice(0, 4) },
		],
		['one item, by country', { ...whole, sessions: false, item: 'offers:1', groupBy: 'country' }],
		['one item on one page', { ...whole, sessions: false, item: 'offers:3', path: '/checkout' }],
		[
			'page matches ^/blog/',
			filtered({ dimension: 'page', operator: 'matches', value: '^/blog/' }),
		],
	]
}

describeForDb('engine raw reads, visits and realtime', {}, (db) => {
	let booted: BootedPayload
	let store: EventStore
	const memory = memoryEventStore()
	const timings: Array<[string, number]> = []

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin() })
		store = createEventStore(booted.payload)
		expect(await store.append(ALL)).toEqual({ written: ALL.length, duplicates: 0 })
		await memory.append(ALL)
	}, 240_000)

	afterAll(async () => {
		// biome-ignore lint/plugin/noProcessEnv: an opt-in timing report, read by no test
		const report = process.env.ANALYTICS_READ_TIMINGS
		if (report) {
			appendFileSync(
				report,
				`${timings.map(([name, ms]) => `${db}\t${ms.toFixed(1)}\t${name}`).join('\n')}\n`
			)
		}
		await booted?.stop()
	})

	/** The store's answer, checked against the memory store's, which is the reference. */
	const both = async (raw: RawRead): Promise<RawRow[]> => {
		const answer = await store.readRaw(raw)
		expect(answer).toEqual(await memory.readRaw(raw))
		return answer
	}

	describe('visits', () => {
		it('opens a visit more than 30 minutes after the last activity, and not at exactly 30', async () => {
			const rows = await both(read('gap', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'))
			expect(partsOf(rows, ['pageviews', 'visitors', 'sessions', 'entries', 'bounces'])).toEqual([
				{ value: null, pageviews: 4, visitors: 1, sessions: 2, entries: 2, bounces: 0 },
			])
		})

		it("keeps a long read in one visit through its engagement's lastAt, even one arriving first", async () => {
			const window = read('engaged', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')
			const [total] = await both(window)
			expect(total?.parts).toMatchObject({
				pageviews: 6,
				visitors: 3,
				sessions: 4,
				entries: 4,
				bounces: 2,
				sessionMs: 3_600_000,
				durationMs: 3_600_000,
			})
			const bySource = await both({ ...window, groupBy: 'source' })
			expect(
				partsOf(bySource, ['pageviews', 'sessions', 'entries', 'bounces', 'sessionMs'])
			).toEqual([
				{ value: 'bing', pageviews: 2, sessions: 1, entries: 1, bounces: 0, sessionMs: 1_200_000 },
				{
					value: 'google',
					pageviews: 4,
					sessions: 3,
					entries: 3,
					bounces: 2,
					sessionMs: 2_400_000,
				},
			])
		})

		it("carries the landing visit's attribution into a later visit that opens with an internal link", async () => {
			const window = read('carry', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')
			expect(
				partsOf(await both({ ...window, groupBy: 'source' }), ['pageviews', 'sessions'])
			).toEqual([
				{ value: 'bing', pageviews: 2, sessions: 2 },
				{ value: 'google', pageviews: 3, sessions: 2 },
			])
			expect(partsOf(await both({ ...window, groupBy: 'utmCampaign' }), ['sessions'])).toEqual([
				{ value: 'spring', sessions: 2 },
			])
			expect(partsOf(await both({ ...window, groupBy: 'referrer' }), ['sessions'])).toEqual([
				{ value: 'bing.com', sessions: 2 },
				{ value: 'google.com', sessions: 2 },
			])
			expect(partsOf(await both({ ...window, groupBy: 'channel' }), ['sessions'])).toEqual([
				{ value: 'organic-search', sessions: 4 },
			])
		})

		it('splits a visit at midnight into two, the second reading direct', async () => {
			const window = read('midnight', '2026-10-06T00:00:00.000Z', '2026-10-08T00:00:00.000Z')
			const [total] = await both(window)
			expect(total?.parts).toMatchObject({ visitors: 2, sessions: 2, entries: 2 })
			expect(partsOf(await both({ ...window, groupBy: 'source' }), ['sessions'])).toEqual([
				{ value: 'direct', sessions: 1 },
				{ value: 'google', sessions: 1 },
			])
		})

		it('counts a bounce only for one pageview and no event, an engagement aside', async () => {
			const window = read('bounce', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')
			const [total] = await both(window)
			expect(total?.parts).toMatchObject({ entries: 4, bounces: 1, sessions: 4, scrollSum: 40 })
			expect(
				partsOf(await both({ ...window, groupBy: 'page' }), ['entries', 'bounces', 'pageviews'])
			).toEqual([
				{ value: '/', entries: 3, bounces: 1, pageviews: 3 },
				{ value: '/a', entries: 0, bounces: 0, pageviews: 1 },
				{ value: '/x', entries: 1, bounces: 0, pageviews: 0 },
			])
		})

		it('never puts a hit without a visitor in a visit', async () => {
			const window = read('anon', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')
			const [total] = await both(window)
			expect(total?.parts).toMatchObject({
				events: 1,
				pageviews: 1,
				visitors: 1,
				sessions: 1,
				entries: 1,
				conversions: 1,
				revenue: 5,
			})
			expect(
				partsOf(await both({ ...window, groupBy: 'source' }), ['pageviews', 'conversions'])
			).toEqual([{ value: 'google', pageviews: 1, conversions: 0 }])
			expect(
				partsOf(await both({ ...window, groupBy: 'goal' }), [
					'conversions',
					'revenue',
					'visitors',
					'sessions',
				])
			).toEqual([{ value: 'purchase', conversions: 1, revenue: 5, visitors: 0, sessions: 0 }])
		})
	})

	describe('filters', () => {
		const window = read('filters', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')
		const where = (...list: AnalyticsFilter[]): RawRead => ({ ...window, filters: list })

		it('filters hits after the visits are cut: entries count only visits entering there', async () => {
			const [row] = await both(where({ dimension: 'page', operator: 'eq', value: '/pricing' }))
			expect(row?.parts).toMatchObject({
				pageviews: 2,
				events: 1,
				visitors: 2,
				sessions: 2,
				entries: 1,
				bounces: 0,
			})
		})

		it('filters visits by their attributes, keeping every hit of a matching visit', async () => {
			const [row] = await both(where({ dimension: 'source', operator: 'eq', value: 'google' }))
			expect(row?.parts).toMatchObject({
				pageviews: 3,
				events: 1,
				visitors: 2,
				sessions: 2,
				entries: 2,
				bounces: 1,
			})
			const both2 = await both(
				where(
					{ dimension: 'source', operator: 'eq', value: 'google' },
					{ dimension: 'page', operator: 'eq', value: '/pricing' }
				)
			)
			expect(both2[0]?.parts).toMatchObject({ pageviews: 1, events: 1, sessions: 1, entries: 0 })
			const [mobileGermans] = await both(
				where(
					{ dimension: 'country', operator: 'eq', value: 'DE' },
					{ dimension: 'device', operator: 'eq', value: 'mobile' }
				)
			)
			expect(mobileGermans?.parts).toMatchObject({ pageviews: 1, visitors: 1 })
			const byPage = await both({
				...where({ dimension: 'source', operator: 'eq', value: 'google' }),
				groupBy: 'page',
			})
			expect(partsOf(byPage, ['pageviews', 'events'])).toEqual([
				{ value: '/', pageviews: 1, events: 0 },
				{ value: '/docs', pageviews: 1, events: 0 },
				{ value: '/pricing', pageviews: 1, events: 1 },
			])
		})

		it('matches % and _ in a contains needle literally, ignoring case', async () => {
			const pagesWith = async (value: string) =>
				(
					await both({
						...read('contains', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
						groupBy: 'page',
						filters: [{ dimension: 'page', operator: 'contains', value }],
					})
				).map((row) => row.value)
			expect(await pagesWith('_50%')).toEqual(['/SALE_50%/x', '/sale_50%'])
			expect(await pagesWith('SALE')).toEqual(['/SALE_50%/x', '/sale-50x', '/sale_50%'])
			expect(await pagesWith('%')).toEqual(['/SALE_50%/x', '/sale_50%'])
			expect(await pagesWith('_')).toEqual(['/SALE_50%/x', '/sale_50%'])
		})

		it('refuses a filter the database cannot apply, naming it', async () => {
			const regex = where({ dimension: 'page', operator: 'matches', value: '^/pri' })
			if (supportsFilter(store.features, { dimension: 'page', operator: 'matches' })) {
				const [row] = await both(regex)
				expect(row?.parts.pageviews).toBe(2)
			} else {
				await expect(store.readRaw(regex)).rejects.toBeInstanceOf(UnsupportedFilterError)
			}
			await expect(
				store.readRaw(where({ dimension: 'medium', operator: 'eq', value: 'cpc' }))
			).rejects.toBeInstanceOf(UnsupportedFilterError)
		})
	})

	describe('ranking', () => {
		const window = {
			...read('topn', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
			groupBy: 'page' as const,
		}

		it('orders and limits in the database, ties by value', async () => {
			const top = await both({ ...window, order: { part: 'pageviews', dir: 'desc' }, limit: 4 })
			expect(partsOf(top, ['pageviews'])).toEqual([
				{ value: '/a', pageviews: 5 },
				{ value: '/b', pageviews: 4 },
				{ value: '/c', pageviews: 3 },
				{ value: '/d', pageviews: 2 },
			])
			const bottom = await both({ ...window, order: { part: 'pageviews', dir: 'asc' }, limit: 2 })
			expect(bottom.map((row) => row.value)).toEqual(['/e', '/d'])
		})

		it('ranks by an average, a row with nothing to divide by last', async () => {
			const rows = await both({
				...window,
				order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
				limit: 3,
			})
			expect(rows.map((row) => row.value)).toEqual(['/f', '/c', '/d'])
		})

		it('fills in exactly the values asked for, and nothing for a value with no hits', async () => {
			const rows = await both({ ...window, values: ['/f', '/d', '/zzz'] })
			expect(partsOf(rows, ['pageviews'])).toEqual([
				{ value: '/d', pageviews: 2 },
				{ value: '/f', pageviews: 2 },
			])
			expect(await both({ ...window, values: [] })).toEqual([])
		})
	})

	describe('realtime', () => {
		const window = {
			scope: 'live',
			start: at('2026-10-06T10:00:00.000Z'),
			end: at('2026-10-06T10:30:00.000Z'),
			timeoutMs: TIMEOUT,
		}

		it('counts visitors and pageviews by minute, with top pages and the sources of their visits', async () => {
			const result = await store.realtime({ ...window, from: at('2026-10-06T00:00:00.000Z') })
			expect(result).toEqual(
				await memory.realtime({ ...window, from: at('2026-10-06T00:00:00.000Z') })
			)
			expect(result).toEqual({
				visitors: 3,
				pageviews: 3,
				minutes: [
					{ minute: at('2026-10-06T10:01:00.000Z'), visitors: 1, pageviews: 1 },
					{ minute: at('2026-10-06T10:02:00.000Z'), visitors: 1, pageviews: 1 },
					{ minute: at('2026-10-06T10:15:00.000Z'), visitors: 1, pageviews: 1 },
					{ minute: at('2026-10-06T10:20:00.000Z'), visitors: 1, pageviews: 0 },
				],
				pages: [
					{ value: '/a', visitors: 2, pageviews: 1 },
					{ value: '/b', visitors: 2, pageviews: 2 },
				],
				sources: [
					{ value: 'bing', visitors: 1, pageviews: 1 },
					{ value: 'google', visitors: 1, pageviews: 2 },
					{ value: 'news.example', visitors: 1, pageviews: 0 },
				],
			})
		})

		it('credits a visit begun before the window to its first hit inside it without a lookback', async () => {
			const result = await store.realtime({ ...window, top: 2 })
			expect(result).toEqual(await memory.realtime({ ...window, top: 2 }))
			expect(result.sources.map((source) => source.value)).toEqual(['bing', 'direct'])
			expect(result.pages).toHaveLength(2)
		})

		it('narrows to one page', async () => {
			const result = await store.realtime({ ...window, path: '/b' })
			expect(result).toEqual(await memory.realtime({ ...window, path: '/b' }))
			expect(result).toMatchObject({ visitors: 2, pageviews: 2, pages: [{ value: '/b' }] })
		})
	})

	describe('windows and scopes', () => {
		it('says whether a window holds any hit', async () => {
			const day1 = { start: at('2026-10-06T10:00:00.000Z'), end: at('2026-10-06T10:30:00.000Z') }
			expect(await store.hasHits({ scope: 'live', ...day1 })).toBe(true)
			expect(
				await store.hasHits({
					scope: 'live',
					start: at('2026-10-06T11:00:00.000Z'),
					end: at('2026-10-06T12:00:00.000Z'),
				})
			).toBe(false)
			expect(await store.hasHits({ scope: 'nobody', ...day1 })).toBe(false)
		})

		it('lists every scope with hits, in code point order', async () => {
			expect(await store.scopes()).toEqual(await memory.scopes())
			expect(await store.scopes()).toEqual([
				'anon',
				'bounce',
				'carry',
				'contains',
				'engaged',
				'filters',
				'gap',
				'live',
				'midnight',
				'parity',
				'parity-b',
				'parity-b-other',
				'parity-other',
				'topn',
			])
		})
	})

	describe.each(PARITY)('parity with the memory store on random fixture $seed', (parity) => {
		for (const [name, raw] of battery(parity)) {
			it(name, async () => {
				const unsupported = raw.filters.find((filter) => !supportsFilter(store.features, filter))
				if (unsupported) {
					await expect(store.readRaw(raw)).rejects.toBeInstanceOf(UnsupportedFilterError)
					return
				}
				const started = performance.now()
				const answer = await store.readRaw(raw)
				timings.push([`${parity.scope}: ${name}`, performance.now() - started])
				expect(answer).toEqual(await memory.readRaw(raw))
				expect(answer.length).toBeGreaterThan(0)
			})
		}
	})

	// Postgres compares its keys byte by byte and still folds a `contains` by its own collation, as
	// MongoDB and the memory store fold every letter; SQLite folds ASCII letters alone.
	it(`folds case past ASCII for contains wherever the database can, on ${db}`, async () => {
		const [fixture] = PARITY
		const start = fixture?.days[0]
		const end = fixture?.days[4]
		if (!fixture || !start || !end) {
			throw new Error('no parity fixture')
		}
		const raw: RawRead = {
			scope: fixture.scope,
			start,
			end,
			filters: [{ dimension: 'page', operator: 'contains', value: 'ÜBER' }],
			groupBy: 'page',
			sessions: true,
			timeoutMs: TIMEOUT,
		}
		const answer = await store.readRaw(raw)
		if (db === 'sqlite') {
			expect(answer).toEqual([])
			return
		}
		expect(answer).toEqual(await memory.readRaw(raw))
		expect(answer.map((row) => row.value)).toEqual(['/über'])
	})
})
