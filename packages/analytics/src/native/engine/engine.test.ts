import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery, MetricKey } from '../../core/contract'
import { UnsupportedFilterError } from '../../core/sourceErrors'
import { classifyError } from '../../surfacing/classifyError'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { dedupeKeyFor } from '../ingest/revenue'
import { AGGREGATION_VERSION, dayWindow } from '../store/aggregate'
import { DEFAULT_CAPS } from '../store/caps'
import { orderHitId, serverTwinOf } from '../store/ids'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import { ReadTimeoutError, rawFilterMap, readRealtime } from '../store/rawRead'
import { DAY_LEASE_MS, dayKey } from '../store/state'
import type {
	AggregateRead,
	EventStore,
	HitRow,
	RawRead,
	RealtimeRead,
	StateStore,
} from '../store/types'
import { MAINTAIN_TASK_SLUG } from '../tasks/maintainTask'
import { localDay } from './days'
import { createEngine, type EngineOptions, type NativeEngine } from './engine'
import { rawAnswer } from './rawAnswer'

const MINUTE = 60_000
const TODAY = 20261007
/** Noon on a Wednesday: the week of Monday the 5th runs, the one of Monday 28 September closed. */
const NOON = new Date('2026-10-07T12:00:00.000Z')

/** Mulberry32, so a fixture is the same fixture every run. */
const seeded = (seed: number): (() => number) => {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const PAGES = ['/', '/pricing', '/blog/a', '/blog/b', '/docs', '/über']
const LANDINGS: ReadonlyArray<Partial<HitRow>> = [
	{ ref: 'google.com', source: 'google', channel: 'organic-search' },
	{ ref: 'news.example', source: 'news.example', channel: 'referral' },
	{
		source: 'newsletter',
		channel: 'email',
		utmSource: 'newsletter',
		utmMedium: 'email',
		utmCampaign: 'fall',
		utmContent: 'hero',
		utmTerm: 'boots',
	},
	{ source: 'direct', channel: 'direct' },
]
const PLACES: ReadonlyArray<Partial<HitRow>> = [
	{ country: 'DE', region: 'BE', city: 'Berlin', language: 'de' },
	{ country: 'US', region: 'CA', city: 'Los Angeles', language: 'en-us' },
	{ country: 'FR', language: 'fr' },
]
const DEVICES: ReadonlyArray<Partial<HitRow>> = [
	{ device: 'desktop', browser: 'chrome', os: 'macos' },
	{ device: 'mobile', browser: 'safari', os: 'ios' },
]
const ITEMS = ['offers:1', 'offers:2']

let serial = 0

/**
 * A local day of one scope's hits, ids per day as daily salts make them, every kind of hit and a
 * webhook sale; `until` keeps today's before noon.
 */
const dayHits = (
	scope: string,
	day: CalendarDay,
	more: { tz?: string; people?: number; until?: Date } = {}
): HitRow[] => {
	const tz = more.tz ?? 'UTC'
	const random = seeded(day * 7 + (more.people ?? 6) + scope.length)
	const pick = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(random() * items.length)]
		if (item === undefined) {
			throw new Error('picked from nothing')
		}
		return item
	}
	const start = calendarDayStart(day, tz).getTime()
	const hits: HitRow[] = []
	const add = (offsetMinutes: number, hit: Omit<HitRow, 'id' | 'scope' | 'ts'>): void => {
		const ts = new Date(start + offsetMinutes * MINUTE)
		if (more.until && ts >= more.until) {
			return
		}
		hits.push({ id: `H${String(serial++).padStart(9, '0')}`, scope, ts, ...hit })
	}
	for (const hostname of ['a.example', 'b.example']) {
		for (let person = 0; person < (more.people ?? 6); person++) {
			const v = `${day}${hostname.slice(0, 1)}${person}`.padEnd(16, 'x')
			const who = { ...pick(PLACES), ...pick(DEVICES) }
			let clock = 30 + person * 95 + (hostname === 'b.example' ? 40 : 0)
			for (let visit = 0; visit < 1 + (person % 2); visit++) {
				const steps = 1 + Math.floor(random() * 4)
				for (let step = 0; step < steps; step++) {
					const base = { hostname, v, path: pick(PAGES), landing: false, server: false }
					const roll = random()
					if (step === 0) {
						add(clock, {
							...base,
							...who,
							type: 'pageview',
							...(visit === 0
								? { ...pick(LANDINGS), landing: true }
								: { source: 'direct', channel: 'direct' }),
							...(random() < 0.5 ? { scrollDepth: 0 } : {}),
						})
					} else if (roll < 0.35) {
						add(clock, { ...base, ...who, type: 'pageview', source: 'direct', channel: 'direct' })
					} else if (roll < 0.55) {
						const name = pick(['signup', 'item_click'])
						add(clock, {
							...base,
							...who,
							type: 'event',
							name,
							source: 'direct',
							channel: 'direct',
							...(name === 'item_click' ? { item: pick(ITEMS) } : {}),
						})
					} else if (roll < 0.7) {
						const value = pick([10, 20, 35])
						add(clock, {
							...base,
							...who,
							type: 'goal',
							name: 'purchase',
							path: '/checkout',
							source: 'direct',
							channel: 'direct',
							value,
							currency: pick(['EUR', 'USD']),
							conversions: 1,
							revenue: value,
							goals: [{ slug: 'purchase', value }],
							...(random() < 0.5 ? { item: pick(ITEMS) } : {}),
						})
					} else {
						add(clock, {
							...base,
							type: 'engagement',
							lastAt: new Date(start + (clock + 2) * MINUTE),
							durationMs: (1 + Math.floor(random() * 90)) * 1000,
							...(random() < 0.6 ? { scrollDepth: 10 + Math.floor(random() * 80) } : {}),
							...(random() < 0.6 ? { impressions: [pick(ITEMS)] } : {}),
						})
					}
					clock += 3
				}
				clock += 40
			}
		}
	}
	add(13 * 60, {
		hostname: 'a.example',
		path: '/api/webhook',
		v: '',
		type: 'goal',
		name: 'purchase',
		landing: false,
		server: true,
		value: 50,
		currency: 'EUR',
		conversions: 1,
		revenue: 50,
		goals: [{ slug: 'purchase', value: 50 }],
	})
	return hits
}

/** Every day from `from` through `to`, oldest first. */
const daysFrom = (from: CalendarDay, to: CalendarDay): CalendarDay[] => {
	const days: CalendarDay[] = []
	for (let day = from; day <= to; day = addCalendarDays(day, 1)) {
		days.push(day)
	}
	return days
}

const quietLogger = { logger: { warn: () => undefined } }

interface Rig {
	store: EventStore
	state: StateStore
	engine: NativeEngine
	clock: { at: Date }
}

const rig = async (options: EngineOptions = {}, hits: readonly HitRow[] = []): Promise<Rig> => {
	const clock = { at: NOON }
	const now = () => new Date(clock.at.getTime())
	const state = memoryStateStore({ now })
	const store = memoryEventStore({ state, now })
	const engine = createEngine({
		// The engine only reaches for Payload's logger, which a test silences.
		payload: quietLogger as unknown as Payload,
		store,
		state,
		options: { now, warn: () => undefined, ...options },
	})
	await store.append(hits)
	return { store, state, engine, clock }
}

const range = (from: CalendarDay, to: CalendarDay, tz = 'UTC'): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: new Date(localDay(to, tz).end.getTime() - 1),
})

/** Today from its start up to now, as the presets read it. */
const upToNow = (from: CalendarDay, tz = 'UTC'): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: NOON,
})

const COUNTS: MetricKey[] = [
	'pageviews',
	'visitors',
	'sessions',
	'events',
	'conversions',
	'revenue',
]
const EVERYTHING: MetricKey[] = [
	...COUNTS,
	'bounceRate',
	'avgDuration',
	'visitDuration',
	'scrollDepth',
]

const answerOf = async (engine: NativeEngine, query: AnalyticsQuery) => {
	const { rows, totals } = await engine.read(query)
	return { rows, totals }
}

const HISTORY = daysFrom(20260928, TODAY).flatMap((day) =>
	dayHits('', day, day === TODAY ? { until: NOON } : {})
)

describe('engine reads equal raw reads alone', () => {
	const battery: Array<[string, AnalyticsQuery]> = [
		['totals', { metrics: EVERYTHING, dateRange: upToNow(20260928) }],
		['a day series', { metrics: EVERYTHING, dateRange: upToNow(20260928), granularity: 'day' }],
		['weeks', { metrics: EVERYTHING, dateRange: upToNow(20260928), granularity: 'week' }],
		['months', { metrics: EVERYTHING, dateRange: upToNow(20260928), granularity: 'month' }],
		['the hours of today', { metrics: COUNTS, dateRange: upToNow(TODAY), granularity: 'hour' }],
		[
			'a closed week, the comparison',
			{ metrics: EVERYTHING, dateRange: range(20260928, 20261004) },
		],
		...(
			[
				'page',
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
				'event',
				'goal',
				'currency',
			] as const
		).map((dimension): [string, AnalyticsQuery] => [
			`by ${dimension}`,
			{ metrics: [...COUNTS, 'bounceRate'], dimensions: [dimension], dateRange: upToNow(20260928) },
		]),
		[
			'items by views',
			{
				metrics: ['impressions', 'interactions', 'visitors', 'conversions'],
				dimensions: ['item'],
				dateRange: upToNow(20260928),
			},
		],
		[
			'top 3 pages by visitors',
			{
				metrics: COUNTS,
				dimensions: ['page'],
				order: { metric: 'visitors', direction: 'desc' },
				limit: 3,
				dateRange: upToNow(20260928),
			},
		],
		[
			'sources by bounce rate',
			{
				metrics: ['bounceRate', 'sessions'],
				dimensions: ['source'],
				order: { metric: 'bounceRate', direction: 'asc' },
				dateRange: upToNow(20260928),
			},
		],
		[
			'one source by day',
			{
				metrics: EVERYTHING,
				filters: [{ dimension: 'source', operator: 'eq', value: 'google' }],
				granularity: 'day',
				dateRange: upToNow(20260928),
			},
		],
		['one page', { metrics: EVERYTHING, path: '/pricing', dateRange: upToNow(20260928) }],
		...(['channel', 'source', 'utmCampaign'] as const).map(
			(dimension): [string, AnalyticsQuery] => [
				`purchases by ${dimension}`,
				{
					metrics: ['conversions', 'revenue', 'visitors'],
					dimensions: [dimension],
					filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
					dateRange: upToNow(20260928),
				},
			]
		),
		[
			'an item',
			{
				metrics: ['impressions', 'interactions', 'visitors', 'events', 'conversions', 'revenue'],
				item: 'offers:1',
				dateRange: upToNow(20260928),
			},
		],
		[
			'an item by day',
			{
				metrics: ['impressions'],
				item: 'offers:1',
				granularity: 'day',
				dateRange: upToNow(20260928),
			},
		],
		[
			'the pages of an item',
			{
				metrics: ['impressions', 'interactions'],
				dimensions: ['page'],
				item: 'offers:2',
				dateRange: upToNow(20260928),
			},
		],
		[
			'the clickers of an item by country',
			{
				metrics: ['visitors', 'interactions'],
				dimensions: ['country'],
				filters: [{ dimension: 'item', operator: 'eq', value: 'offers:1' }],
				dateRange: upToNow(20260928),
			},
		],
		[
			'a filter with a breakdown',
			{
				metrics: COUNTS,
				dimensions: ['page'],
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
				dateRange: upToNow(20260928),
			},
		],
		[
			'a contains filter',
			{
				metrics: EVERYTHING,
				filters: [{ dimension: 'page', operator: 'contains', value: 'BLOG' }],
				granularity: 'week',
				dateRange: upToNow(20260928),
			},
		],
		[
			'one hostname',
			{
				metrics: EVERYTHING,
				hostname: 'b.example',
				granularity: 'day',
				dateRange: upToNow(20260928),
			},
		],
	]

	it('answers every question the same, closed days aggregated beforehand, lazily or read raw', async () => {
		const ready = await rig({}, HISTORY)
		for (const day of daysFrom(20260928, 20261002)) {
			expect(await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })).toMatchObject({
				outcome: 'completed',
			})
		}
		for (const [name, query] of battery) {
			const expected = await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
			expect({ name, ...(await answerOf(ready.engine, query)) }).toEqual({ name, ...expected })
		}
		const markers = await ready.state.markers('', 20260928, TODAY)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20260928, 'final'],
			[20260929, 'final'],
			[20260930, 'final'],
			[20261001, 'final'],
			[20261002, 'final'],
			[20261003, 'final'],
			[20261004, 'final'],
			[20261005, 'final'],
			[20261006, 'provisional'],
		])
	})

	it('aggregates a missing closed day during the read and reads the rest of its week from rows', async () => {
		const ready = await rig({}, HISTORY)
		const query: AnalyticsQuery = {
			metrics: EVERYTHING,
			dateRange: range(20261005, 20261006),
			granularity: 'day',
		}
		const result = await ready.engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		)
		expect(result.meta).toEqual({
			provider: 'native',
			fetchedAt: NOON.toISOString(),
			visitorsAre: 'sumOfDaily',
			mixedCurrencies: ['EUR', 'USD'],
		})
		const markers = await ready.state.markers('', 20261005, 20261006)
		expect(markers.map((marker) => [marker.day, marker.status, marker.version])).toEqual([
			[20261005, 'final', AGGREGATION_VERSION],
			[20261006, 'provisional', AGGREGATION_VERSION],
		])
	})

	it('counts visitors distinct over one day and as a sum of days over several', async () => {
		const ready = await rig({}, HISTORY)
		const one = await ready.engine.read({
			metrics: ['visitors'],
			dateRange: range(20261003, 20261003),
		})
		expect(one.meta.visitorsAre).toBe('distinct')
		const pages = await ready.engine.read({
			metrics: ['pageviews'],
			dateRange: range(20261001, 20261003),
		})
		expect(pages.meta.visitorsAre).toBeUndefined()
	})
})

describe('days nothing aggregated', () => {
	it('counts none while a jobs runner is fresh: the newest within the raw allowance are read raw, the rest missing', async () => {
		const ready = await rig({ lazy: { rawDays: 2 } }, HISTORY)
		await ready.state.beat(MAINTAIN_TASK_SLUG)
		const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: range(20261001, 20261005) }
		const result = await ready.engine.read(query)
		expect(result.meta.partial).toEqual({ missingDays: 3 })
		const raw = await rawAnswer(
			ready.store,
			{ ...query, dateRange: range(20261004, 20261005) },
			{ scope: '', tz: 'UTC' }
		)
		expect(result.totals).toEqual(raw.totals)
		await ready.engine.idle()
		expect(await ready.state.markers('', 20261001, 20261005)).toEqual([])
	})

	it('reads none of them without any budget, and starts maintenance', async () => {
		const ready = await rig({ lazy: { budgetMs: 0 }, maintenance: { runner: false } }, HISTORY)
		const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: range(20261001, 20261005) }
		const result = await ready.engine.read(query)
		expect(result.meta.partial).toEqual({ missingDays: 5 })
		expect(result.totals).toEqual({ pageviews: 0 })
		await ready.engine.idle()
		const markers = await ready.state.markers('', 20261001, 20261005)
		expect(markers.map((marker) => marker.status)).toEqual([
			'final',
			'final',
			'final',
			'final',
			'final',
		])
	})

	it('counts only the days whose predicted cost fits: one its last count says is huge is left out', async () => {
		const ready = await rig({ maintenance: { runner: false } }, HISTORY)
		// Maintenance counts every closed day first, and its nudge window keeps the read from starting another.
		ready.engine.nudge()
		await ready.engine.idle()
		const [counted] = await ready.state.markers('', 20261004, 20261004)
		if (!counted) {
			throw new Error('maintenance counted no day')
		}
		expect(await ready.state.claim(dayKey('', 20261004), 'old', DAY_LEASE_MS)).toBe(true)
		expect(await ready.state.complete({ ...counted, hits: 1_000_000_000 }, 'old')).toBe(true)
		await ready.state.markDirty('', [20261003, 20261004, 20261005])
		const query: AnalyticsQuery = { metrics: COUNTS, dateRange: range(20261003, 20261005) }
		const started = Date.now()
		const result = await ready.engine.read(query)
		expect(Date.now() - started).toBeLessThan(3_000)
		expect(result.meta.partial).toEqual({ missingDays: 1 })
		const kept = await Promise.all(
			[range(20261003, 20261003), range(20261005, 20261005)].map((dateRange) =>
				rawAnswer(ready.store, { ...query, dateRange }, { scope: '', tz: 'UTC' })
			)
		)
		for (const metric of ['pageviews', 'events', 'conversions', 'revenue'] as const) {
			expect(result.totals?.[metric]).toBe(
				kept.reduce((sum, answer) => sum + (answer.totals[metric] ?? 0), 0)
			)
		}
		const markers = await ready.state.markers('', 20261003, 20261005)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20261003, 'final'],
			[20261004, 'dirty'],
			[20261005, 'final'],
		])
	})

	it('reads raw only the uncounted days whose bounded count fits while a jobs runner is fresh', async () => {
		const ready = await rig({}, HISTORY)
		await ready.state.beat(MAINTAIN_TASK_SLUG)
		const bounds: number[] = []
		const store: EventStore = {
			...ready.store,
			countHits: async (window, atMost) => {
				bounds.push(atMost)
				// 4 October holds more than three seconds read, whatever it really holds.
				return window.start.getTime() === calendarDayStart(20261004, 'UTC').getTime()
					? atMost + 1
					: ready.store.countHits(window, atMost)
			},
		}
		const engine = createEngine({
			payload: quietLogger as unknown as Payload,
			store,
			state: ready.state,
			options: { now: () => NOON, warn: () => undefined },
		})
		const query: AnalyticsQuery = { metrics: COUNTS, dateRange: range(20261003, 20261005) }
		const result = await engine.read(query)
		expect(result.meta.partial).toEqual({ missingDays: 1 })
		const kept = await Promise.all(
			[range(20261003, 20261003), range(20261005, 20261005)].map((dateRange) =>
				rawAnswer(ready.store, { ...query, dateRange }, { scope: '', tz: 'UTC' })
			)
		)
		for (const metric of ['pageviews', 'events', 'conversions', 'revenue'] as const) {
			expect(result.totals?.[metric]).toBe(
				kept.reduce((sum, answer) => sum + (answer.totals[metric] ?? 0), 0)
			)
		}
		expect(Math.max(...bounds)).toBeLessThanOrEqual(1_500_000)
		await engine.close()
		expect(await ready.state.markers('', 20261003, 20261005)).toEqual([])
	})

	it('reads a day another run is aggregating raw, and answers the same', async () => {
		const ready = await rig({}, HISTORY)
		await ready.state.ensureMarkers([{ scope: '', day: 20261004, tz: 'UTC' }])
		expect(await ready.state.claim(dayKey('', 20261004), 'elsewhere', DAY_LEASE_MS)).toBe(true)
		const query: AnalyticsQuery = { metrics: EVERYTHING, dateRange: range(20261003, 20261005) }
		const result = await ready.engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		)
		expect(result.meta.partial).toBeUndefined()
		const [busy] = await ready.state.markers('', 20261004, 20261004)
		expect(busy).toMatchObject({ status: 'open', leaseOwner: 'elsewhere' })
	})

	it('marks sealed days without hits empty, and reads them from nowhere after', async () => {
		const ready = await rig({}, HISTORY)
		const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: range(20260920, 20260930) }
		const before = await ready.engine.read(query)
		await ready.engine.idle()
		const markers = await ready.state.markers('', 20260920, 20260930)
		expect(
			markers.filter((marker) => marker.status === 'empty').map((marker) => marker.day)
		).toEqual(daysFrom(20260920, 20260927))
		const after = await ready.engine.read(query)
		expect(after.totals).toEqual(before.totals)
		expect(after.totals).toEqual(
			(await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })).totals
		)
	})

	it('aggregates a day of an older aggregation version again', async () => {
		const ready = await rig({}, HISTORY)
		await ready.engine.aggregate({ scope: '', day: 20261003, tz: 'UTC' })
		const [current] = await ready.state.markers('', 20261003, 20261003)
		if (!current) {
			throw new Error('the day was not aggregated')
		}
		expect(await ready.state.claim(dayKey('', 20261003), 'old', DAY_LEASE_MS)).toBe(true)
		expect(
			await ready.state.complete({ ...current, version: AGGREGATION_VERSION - 1 }, 'old')
		).toBe(true)
		const query: AnalyticsQuery = { metrics: EVERYTHING, dateRange: range(20261003, 20261003) }
		const result = await ready.engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		)
		const [again] = await ready.state.markers('', 20261003, 20261003)
		expect(again?.version).toBe(AGGREGATION_VERSION)
		expect(again?.gen).not.toBe(current.gen)
	})

	it('aggregates a day counted in another zone again, in the zone it is read in', async () => {
		const ready = await rig({ timezone: () => 'America/New_York' }, HISTORY)
		const target = { scope: '', day: 20261003, tz: 'UTC' }
		await ready.state.ensureMarkers([target])
		expect(await ready.state.claim(dayKey('', 20261003), 'old', DAY_LEASE_MS)).toBe(true)
		expect(
			await ready.store.aggregateDay(dayWindow('', 20261003, 'UTC'), {
				runId: 'old',
				caps: DEFAULT_CAPS,
				status: 'final',
			})
		).toMatchObject({ completed: true })
		const query: AnalyticsQuery = {
			metrics: EVERYTHING,
			dateRange: range(20261003, 20261003, 'America/New_York'),
			timezone: 'America/New_York',
		}
		const result = await ready.engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'America/New_York' })
		)
		const [marker] = await ready.state.markers('', 20261003, 20261003)
		expect(marker).toMatchObject({ tz: 'America/New_York', status: 'final' })
	})
})

describe('today', () => {
	const big = { today: { snapshotAboveHits: 1 } }

	it('reads today live while it holds few hits, with no snapshot taken', async () => {
		const ready = await rig({}, HISTORY)
		const query: AnalyticsQuery = { metrics: COUNTS, dateRange: upToNow(TODAY) }
		const result = await ready.engine.read(query)
		expect(result.totals).toEqual(
			(await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })).totals
		)
		expect(result.meta.asOf).toBeUndefined()
		expect(await ready.state.markers('', TODAY, TODAY)).toEqual([])
	})

	it('reads a busy site today from a snapshot, serving a stale one while it takes another', async () => {
		const ready = await rig(big, HISTORY)
		await ready.engine.aggregate({ scope: '', day: 20261006, tz: 'UTC' })
		/** Today up to the moment it is read, as the today preset asks. */
		const query = (): AnalyticsQuery => ({
			metrics: COUNTS,
			dateRange: { start: calendarDayStart(TODAY, 'UTC'), end: ready.clock.at },
		})
		const live = await ready.engine.read(query())
		expect(live.totals).toEqual(
			(await rawAnswer(ready.store, query(), { scope: '', tz: 'UTC' })).totals
		)
		expect(live.meta.asOf).toBeUndefined()
		await ready.engine.idle()
		const [snapshot] = await ready.state.markers('', TODAY, TODAY)
		expect(snapshot).toMatchObject({ status: 'partial', aggregatedAt: NOON })
		const first = await ready.engine.read(query())
		expect(first.totals).toEqual(live.totals)
		expect(first.meta.asOf).toBe(NOON.toISOString())

		await ready.store.append(dayHits('', TODAY, { people: 2 }).filter((hit) => hit.ts < NOON))
		ready.clock.at = new Date(NOON.getTime() + MINUTE)
		const fresh = await ready.engine.read(query())
		expect(fresh.totals).toEqual(first.totals)
		expect(fresh.meta.asOf).toBe(NOON.toISOString())

		ready.clock.at = new Date(NOON.getTime() + MINUTE + 1)
		const stale = await ready.engine.read(query())
		expect(stale.totals).toEqual(first.totals)
		expect(stale.meta.asOf).toBe(NOON.toISOString())
		await ready.engine.idle()
		const refreshed = await ready.engine.read(query())
		expect(refreshed.totals).toEqual(
			(await rawAnswer(ready.store, query(), { scope: '', tz: 'UTC' })).totals
		)
		expect(refreshed.totals).not.toEqual(first.totals)
		expect(refreshed.meta.asOf).toBe(ready.clock.at.toISOString())
	})

	it('reads today from a snapshot taken in the background once its raw read is refused, as SQLite refuses a big one', async () => {
		const ready = await rig({}, HISTORY)
		const todayStart = calendarDayStart(TODAY, 'UTC').getTime()
		const refusing: EventStore = {
			...ready.store,
			readRaw: async (read) => {
				if (read.start.getTime() === todayStart) {
					throw new ReadTimeoutError('sqlite', read.timeoutMs)
				}
				return ready.store.readRaw(read)
			},
		}
		const engine = createEngine({
			payload: quietLogger as unknown as Payload,
			store: refusing,
			state: ready.state,
			options: { now: () => NOON, warn: () => undefined },
		})
		const query: AnalyticsQuery = {
			metrics: EVERYTHING,
			dateRange: upToNow(20261005),
			granularity: 'day',
		}
		const refused = await engine.read(query)
		expect(refused.meta.partial).toEqual({ missingDays: 1 })
		expect(refused.meta.asOf).toBeUndefined()
		await engine.idle()
		const result = await engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		)
		expect(result.meta.asOf).toBe(NOON.toISOString())
		expect(result.meta.partial).toBeUndefined()
	})

	it('takes the first snapshot of a busy today in the background, and leaves today out when it would not fit', async () => {
		const ready = await rig({ ...big, lazy: { budgetMs: 0 } }, HISTORY)
		await ready.engine.aggregate({ scope: '', day: 20261006, tz: 'UTC' })
		const query: AnalyticsQuery = { metrics: COUNTS, dateRange: upToNow(TODAY) }
		const first = await ready.engine.read(query)
		expect(first.meta.partial).toEqual({ missingDays: 1 })
		expect(first.totals).toEqual({
			pageviews: 0,
			visitors: 0,
			sessions: 0,
			events: 0,
			conversions: 0,
			revenue: 0,
		})
		await ready.engine.idle()
		const second = await ready.engine.read(query)
		expect(second.meta.partial).toBeUndefined()
		expect(second.meta.asOf).toBe(NOON.toISOString())
		expect(second.totals).toEqual(
			(await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })).totals
		)
	})

	it('reads a filtered day by the hour raw, and counts a refused day missing rather than failing', async () => {
		const ready = await rig({}, HISTORY)
		const refusing: EventStore = {
			...ready.store,
			readRaw: async (read) => {
				if (read.end.getTime() - read.start.getTime() > 86_400_000) {
					throw new ReadTimeoutError('sqlite', read.timeoutMs)
				}
				if (read.start.getTime() === calendarDayStart(20261006, 'UTC').getTime()) {
					throw new ReadTimeoutError('sqlite', read.timeoutMs)
				}
				return ready.store.readRaw(read)
			},
		}
		const engine = createEngine({
			payload: quietLogger as unknown as Payload,
			store: refusing,
			state: ready.state,
			options: { now: () => NOON, warn: () => undefined },
		})
		const query: AnalyticsQuery = {
			metrics: COUNTS,
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			granularity: 'hour',
			dateRange: upToNow(20261005),
		}
		const result = await engine.read(query)
		expect(result.meta.partial).toEqual({ missingDays: 1 })
		const kept = await Promise.all(
			[range(20261005, 20261005), upToNow(TODAY)].map((dateRange) =>
				rawAnswer(ready.store, { ...query, dateRange }, { scope: '', tz: 'UTC' })
			)
		)
		expect(result.rows).toEqual(kept.flatMap((answer) => answer.rows))
	})
})

/** A store whose raw reads are recorded, and refused where `refuse` says. */
const spied = (store: EventStore, refuse: (read: RawRead) => boolean = () => false) => {
	const raws: RawRead[] = []
	const realtimes: RealtimeRead[] = []
	const aggregates: AggregateRead[] = []
	const spy: EventStore = {
		...store,
		readAggregates: async (read) => {
			aggregates.push(read)
			return store.readAggregates(read)
		},
		readRaw: async (read) => {
			raws.push(read)
			if (refuse(read)) {
				throw new ReadTimeoutError('test', read.timeoutMs)
			}
			return store.readRaw(read)
		},
		realtime: async (read) => {
			realtimes.push(read)
			return readRealtime(spy.readRaw, read)
		},
	}
	return { store: spy, raws, realtimes, aggregates }
}

const engineOver = (store: EventStore, state: StateStore, options: EngineOptions = {}) =>
	createEngine({
		payload: quietLogger as unknown as Payload,
		store,
		state,
		options: { now: () => NOON, warn: () => undefined, ...options },
	})

describe('filtered breakdowns', () => {
	const closedDays = daysFrom(20260928, 20261006)
	const byPage: AnalyticsQuery = {
		metrics: [...COUNTS, 'bounceRate'],
		dimensions: ['page'],
		filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		dateRange: upToNow(20260928),
	}

	it("take their totals from the filter's own rows and read only their rows raw", async () => {
		const ready = await rig({}, HISTORY)
		for (const day of closedDays) {
			await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		const { store, raws } = spied(ready.store)
		const engine = engineOver(store, ready.state)
		const result = await engine.read(byPage)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, byPage, { scope: '', tz: 'UTC' })
		)
		const totalsReads = raws.filter((raw) => raw.groupBy === undefined)
		expect(totalsReads.map((raw) => raw.start)).toEqual([calendarDayStart(TODAY, 'UTC')])
		expect(raws.filter((raw) => raw.groupBy === 'page')).toHaveLength(1)
		expect(result.meta.partial).toBeUndefined()
	})

	it('read day by day, newest first, once their rows read is refused', async () => {
		const ready = await rig({}, HISTORY)
		for (const day of closedDays) {
			await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		const { store, raws } = spied(
			ready.store,
			(read) => read.end.getTime() - (read.from ?? read.start).getTime() > 86_400_000
		)
		const engine = engineOver(store, ready.state)
		const result = await engine.read(byPage)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, byPage, { scope: '', tz: 'UTC' })
		)
		expect(result.meta.partial).toBeUndefined()
		const pieces = raws.filter((raw) => raw.groupBy === 'page').slice(1)
		expect(pieces.map((raw) => raw.start)).toEqual(
			[...closedDays, TODAY].reverse().map((day) => calendarDayStart(day, 'UTC'))
		)
		expect(pieces.every((raw) => raw.limit === undefined && raw.values === undefined)).toBe(true)
	})

	it('count the days the split budget leaves unread missing', async () => {
		const ready = await rig({ splitBudgetMs: 0 }, HISTORY)
		const { store } = spied(
			ready.store,
			(read) => read.end.getTime() - (read.from ?? read.start).getTime() > 86_400_000
		)
		const engine = engineOver(store, ready.state, { splitBudgetMs: 0 })
		const result = await engine.read(byPage)
		expect(result.rows).toEqual([])
		expect(result.meta.partial).toEqual({ missingDays: closedDays.length + 1 })
	})
})

describe('a single day beside aggregated days', () => {
	it('is read once, whole, and fills the ranking from what it read', async () => {
		const ready = await rig({}, HISTORY)
		for (const day of daysFrom(20260928, 20261006)) {
			await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		const { store, raws } = spied(ready.store)
		const engine = engineOver(store, ready.state)
		const query: AnalyticsQuery = {
			metrics: COUNTS,
			dimensions: ['source'],
			limit: 2,
			dateRange: upToNow(20260928),
		}
		const result = await engine.read(query)
		expect({ rows: result.rows, totals: result.totals }).toEqual(
			await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		)
		const ranked = raws.filter((raw) => raw.groupBy === 'source')
		expect(ranked).toHaveLength(1)
		expect(ranked[0]).toMatchObject({ start: calendarDayStart(TODAY, 'UTC') })
		expect(ranked[0]?.limit).toBeUndefined()
		expect(ranked[0]?.values).toBeUndefined()
	})
})

describe('reads from raw hits only', () => {
	it('clamps a filtered read to the raw floor and says where the data starts', async () => {
		const ready = await rig({ rawDays: 5 }, HISTORY)
		const query: AnalyticsQuery = {
			metrics: COUNTS,
			filters: [{ dimension: 'device', operator: 'eq', value: 'mobile' }],
			dimensions: ['page'],
			dateRange: upToNow(20260928),
		}
		const result = await ready.engine.read(query)
		expect(result.meta.clamped).toBe(true)
		expect(result.meta.dataFrom).toBe('2026-10-03T00:00:00.000Z')
		const clamped = await rawAnswer(
			ready.store,
			{ ...query, dateRange: upToNow(20261003) },
			{ scope: '', tz: 'UTC' }
		)
		expect({ rows: result.rows, totals: result.totals }).toEqual(clamped)
	})

	it('refuses a filter the store does not apply', async () => {
		const ready = await rig({ filters: rawFilterMap(['eq', 'contains']) }, HISTORY)
		await expect(
			ready.engine.read({
				metrics: ['pageviews'],
				filters: [{ dimension: 'page', operator: 'matches', value: '^/blog' }],
				dateRange: upToNow(TODAY),
			})
		).rejects.toBeInstanceOf(UnsupportedFilterError)
	})
})

describe('scopes', () => {
	const scoped = [
		...daysFrom(20261003, TODAY).flatMap((day) =>
			dayHits('alpha', day, day === TODAY ? { until: NOON } : {})
		),
		...daysFrom(20261003, TODAY).flatMap((day) =>
			dayHits('beta', day, {
				tz: 'America/New_York',
				people: 3,
				...(day >= 20261006 ? { until: NOON } : {}),
			})
		),
	]
	const zones = (scope: string): string => (scope === 'beta' ? 'America/New_York' : 'UTC')

	it('reads each scope in its own zone, and every scope as the sum of them', async () => {
		const ready = await rig({ scoped: true, timezone: zones }, scoped)
		const ownDays = { metrics: COUNTS, granularity: 'day' } as const
		const alphaQuery: AnalyticsQuery = { ...ownDays, dateRange: range(20261004, 20261006) }
		const betaQuery: AnalyticsQuery = {
			...ownDays,
			dateRange: range(20261004, 20261006, 'America/New_York'),
		}
		const alpha = await ready.engine.read({ ...alphaQuery, scope: 'alpha' })
		const beta = await ready.engine.read({ ...betaQuery, scope: 'beta' })
		expect({ rows: alpha.rows, totals: alpha.totals }).toEqual(
			await rawAnswer(ready.store, alphaQuery, { scope: 'alpha', tz: 'UTC' })
		)
		expect({ rows: beta.rows, totals: beta.totals }).toEqual(
			await rawAnswer(ready.store, betaQuery, { scope: 'beta', tz: 'America/New_York' })
		)
		// Both read the same instants: beta's days are cut short at either end and read raw there.
		const instants: AnalyticsQuery = { metrics: COUNTS, dateRange: range(20261004, 20261005) }
		const parts = await Promise.all(
			['alpha', 'beta'].map((scope) => ready.engine.read({ ...instants, scope }))
		)
		const every = await ready.engine.read(instants)
		for (const metric of COUNTS) {
			expect(every.totals?.[metric]).toBe(
				parts.reduce((sum, part) => sum + (part.totals?.[metric] ?? 0), 0)
			)
		}
		expect(parts[1]?.totals).toEqual(
			(await rawAnswer(ready.store, instants, { scope: 'beta', tz: 'America/New_York' })).totals
		)
	})

	it('reads the scopes of one zone together, every scope still the sum of each alone', async () => {
		const hits = [
			...scoped,
			...daysFrom(20261003, TODAY).flatMap((day) =>
				dayHits('gamma', day, { people: 4, ...(day === TODAY ? { until: NOON } : {}) })
			),
		]
		const zoneOf = (scope: string): string => (scope === 'gamma' ? 'UTC' : zones(scope))
		const ready = await rig({ scoped: true, timezone: zoneOf }, hits)
		for (const scope of ['alpha', 'beta', 'gamma']) {
			for (const day of daysFrom(20261003, 20261005)) {
				await ready.engine.aggregate({ scope, day, tz: zoneOf(scope) })
			}
		}
		const { store, raws, aggregates } = spied(ready.store)
		const engine = engineOver(store, ready.state, { scoped: true, timezone: zoneOf })
		const query: AnalyticsQuery = {
			metrics: ['pageviews', 'events', 'conversions', 'revenue'],
			dateRange: upToNow(20261004),
		}
		const every = await engine.read(query)
		const scopesOf = (read: { scope?: string; scopes?: readonly string[] }) =>
			read.scopes ?? [read.scope]
		const utcToday = raws.filter(
			(raw) =>
				raw.groupBy === undefined &&
				raw.buckets === undefined &&
				scopesOf(raw).some((scope) => scope === 'alpha' || scope === 'gamma')
		)
		expect(utcToday.map(scopesOf)).toEqual([['alpha', 'gamma']])
		expect(aggregates.filter((read) => read.groupBy === 'total').map(scopesOf)).toEqual([
			['alpha', 'beta', 'gamma'],
		])
		const each = await Promise.all(
			['alpha', 'beta', 'gamma'].map((scope) => engine.read({ ...query, scope }))
		)
		for (const metric of ['pageviews', 'events', 'conversions', 'revenue'] as const) {
			expect(every.totals?.[metric]).toBe(
				each.reduce((sum, part) => sum + (part.totals?.[metric] ?? 0), 0)
			)
		}
	})

	it('ignores a scope on an unscoped install, whose hits are all under none', async () => {
		const ready = await rig({}, HISTORY)
		const query: AnalyticsQuery = { metrics: COUNTS, dateRange: range(20261003, 20261004) }
		expect((await ready.engine.read({ ...query, scope: 'whatever' })).totals).toEqual(
			(await ready.engine.read(query)).totals
		)
	})
})

describe("a read's signal", () => {
	it('reaches every raw, aggregate and live read it makes, so a pool wait can drop them', async () => {
		const ready = await rig({}, HISTORY)
		for (const day of daysFrom(20260928, 20261006)) {
			await ready.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		const { store, raws, aggregates, realtimes } = spied(ready.store)
		const engine = engineOver(store, ready.state)
		const { signal } = new AbortController()
		await engine.read(
			{ metrics: COUNTS, dimensions: ['page'], dateRange: upToNow(20260928) },
			{ signal }
		)
		const dateRange = { start: new Date(NOON.getTime() - 30 * MINUTE), end: NOON }
		await engine.realtime({ metrics: ['visitors'], dateRange }, { signal })
		expect(raws.length).toBeGreaterThan(1)
		expect(aggregates.length).toBeGreaterThan(0)
		expect(realtimes).toHaveLength(1)
		expect([...raws, ...aggregates, ...realtimes].every((read) => read.signal === signal)).toBe(
			true
		)
	})
})

describe('realtime', () => {
	it('reads only what the query asks for: the totals alone for a counter', async () => {
		const ready = await rig({}, HISTORY)
		const { store, realtimes, raws } = spied(ready.store)
		const engine = engineOver(store, ready.state)
		const dateRange = { start: new Date(NOON.getTime() - 30 * MINUTE), end: NOON }
		const counter = await engine.realtime({ metrics: ['visitors'], dateRange })
		expect(counter.rows).toEqual([])
		expect(realtimes.at(-1)?.parts).toEqual([])
		expect(raws).toHaveLength(1)
		await engine.realtime({ metrics: ['visitors'], dateRange, granularity: 'minute' })
		expect(realtimes.at(-1)?.parts).toEqual(['minutes'])
		await engine.realtime({ metrics: ['visitors'], dateRange, dimensions: ['source'] })
		expect(realtimes.at(-1)?.parts).toEqual(['sources'])
		const sources = raws.at(-1)
		expect(sources?.groupBy).toBe('source')
		expect(sources?.from).toEqual(calendarDayStart(TODAY, 'UTC'))
	})

	it('fails as a timeout when the minutes cannot be read, rather than draw no minute at all', async () => {
		const ready = await rig({}, HISTORY)
		const { store } = spied(ready.store, (read) => read.buckets !== undefined)
		const engine = engineOver(store, ready.state)
		const dateRange = { start: new Date(NOON.getTime() - 30 * MINUTE), end: NOON }
		const failed = await engine
			.realtime({ metrics: ['visitors', 'pageviews'], dateRange, granularity: 'minute' })
			.then(
				() => null,
				(err: unknown) => err
			)
		expect(failed).toBeInstanceOf(ReadTimeoutError)
		expect(classifyError(failed)).toEqual({ kind: 'unavailable', timeout: true })
		await expect(
			engine.realtime({ metrics: ['visitors'], dateRange, dimensions: ['source'] })
		).resolves.toMatchObject({ rows: expect.any(Array) })
		const { store: refusing } = spied(ready.store, (read) => read.groupBy === 'source')
		await expect(
			engineOver(refusing, ready.state).realtime({
				metrics: ['visitors'],
				dateRange,
				dimensions: ['source'],
			})
		).rejects.toBeInstanceOf(ReadTimeoutError)
	})

	it('counts the window by the minute, every minute drawn, and ranks pages and sources', async () => {
		const ready = await rig({}, HISTORY)
		const dateRange = { start: new Date(NOON.getTime() - 30 * MINUTE), end: NOON }
		const live = await ready.engine.realtime({
			metrics: ['visitors', 'pageviews'],
			dateRange,
			granularity: 'minute',
		})
		expect(live.rows).toHaveLength(31)
		expect(live.rows[0]?.timestamp).toBe('2026-10-07T11:30:00.000Z')
		const direct = await ready.store.realtime({
			scope: '',
			start: dateRange.start,
			end: new Date(NOON.getTime() + 1),
			timeoutMs: 1000,
		})
		expect(live.totals).toEqual({ visitors: direct.visitors, pageviews: direct.pageviews })
		const sum = live.rows.reduce((total, row) => total + (row.metrics.pageviews ?? 0), 0)
		expect(sum).toBe(direct.pageviews)
		const pages = await ready.engine.realtime({
			metrics: ['visitors'],
			dimensions: ['page'],
			dateRange: { start: calendarDayStart(TODAY, 'UTC'), end: NOON },
		})
		expect(pages.rows.length).toBeGreaterThan(0)
		expect(Object.keys(pages.rows[0]?.metrics ?? {})).toEqual(['visitors'])
	})
})

describe('a host slower than the measured cost', () => {
	const BIG_DAYS = daysFrom(20260920, 20260927)

	/** Days of 6,000 plain pageviews, enough for a count to say what a hit costs. */
	const bigDays = (): HitRow[] =>
		BIG_DAYS.flatMap((day) => {
			const start = calendarDayStart(day, 'UTC').getTime()
			return Array.from({ length: 6_000 }, (_, index) => ({
				id: `B${day}${String(index).padStart(5, '0')}`,
				scope: '',
				ts: new Date(start + index * 10_000),
				type: 'pageview' as const,
				hostname: 'a.example',
				path: `/p/${index % 50}`,
				v: `${day}${index % 400}`.padEnd(16, 'x'),
				landing: index % 400 === index,
				server: false,
			}))
		})

	/** An engine whose clock a count of `hits` moves on by 40 microseconds a hit, twenty times memory's. */
	const slowEngine = async () => {
		const ready = await rig({}, bigDays())
		const clock = { ms: 0 }
		const store: EventStore = {
			...ready.store,
			aggregateDay: async (window, run) => {
				const result = await ready.store.aggregateDay(window, run)
				clock.ms += result.hits * 0.04
				return result
			},
		}
		const engine = engineOver(store, ready.state, {
			clock: () => clock.ms,
			lazy: { budgetMs: 300, rawDays: 0 },
		})
		return { ready, engine, clock }
	}

	it('learns what its counts take, so a read stops counting within its budget', async () => {
		const slow = await slowEngine()
		for (const day of BIG_DAYS.slice(0, 4)) {
			await slow.engine.aggregate({ scope: '', day, tz: 'UTC' })
		}
		const before = slow.clock.ms
		const read = await slow.engine.read({ metrics: COUNTS, dateRange: range(20260924, 20260927) })
		const spent = slow.clock.ms - before
		expect(spent).toBeGreaterThanOrEqual(240)
		expect(spent).toBeLessThanOrEqual(300)
		expect(read.meta.partial).toEqual({ missingDays: 3 })
	})
})

describe('counts a read starts', () => {
	it('are bounded by the read timeout, unlike those of maintenance or aggregate()', async () => {
		const ready = await rig({}, HISTORY)
		const runs: Array<number | undefined> = []
		const store: EventStore = {
			...ready.store,
			aggregateDay: async (window, run) => {
				runs.push(run.timeoutMs)
				return ready.store.aggregateDay(window, run)
			},
		}
		const engine = engineOver(store, ready.state, { timeoutMs: 4_000 })
		await engine.read({ metrics: COUNTS, dateRange: range(20261001, 20261003) })
		await engine.idle()
		expect(runs.length).toBeGreaterThan(0)
		expect(runs.every((timeoutMs) => timeoutMs === 4_000)).toBe(true)
		runs.length = 0
		await engine.aggregate({ scope: '', day: 20260929, tz: 'UTC' })
		await engine.snapshot({ scope: '', day: TODAY, tz: 'UTC' })
		await engine.maintain({ budgetMs: 30_000 })
		expect(runs.length).toBeGreaterThan(2)
		expect(runs.every((timeoutMs) => timeoutMs === undefined)).toBe(true)
	})
})

describe('a range reaching far back', () => {
	const FAR = new Date('1000-01-01T00:00:00.000Z')

	/** The store, its day probes and counts recorded by where their windows start. */
	const probed = (store: EventStore) => {
		const starts: Date[] = []
		const spy: EventStore = {
			...store,
			hasHits: async (window) => {
				starts.push(window.start)
				return store.hasHits(window)
			},
			countHits: async (window, atMost) => {
				starts.push(window.start)
				return store.countHits(window, atMost)
			},
		}
		return { store: spy, starts }
	}

	it("plans from the scope's oldest hit, so a read from the year 1000 costs nothing extra", async () => {
		for (const rawDays of [null, 90]) {
			const ready = await rig({ rawDays }, HISTORY)
			const { store, starts } = probed(ready.store)
			const engine = engineOver(store, ready.state, { rawDays })
			const near = await engine.read({ metrics: COUNTS, dateRange: upToNow(20260928) })
			starts.length = 0
			const far = await engine.read({ metrics: COUNTS, dateRange: { start: FAR, end: NOON } })
			expect(far.totals).toEqual(near.totals)
			expect(far.meta.clamped).toBeUndefined()
			expect(starts.every((start) => start >= calendarDayStart(20260928, 'UTC'))).toBe(true)
			const filtered: AnalyticsQuery = {
				metrics: COUNTS,
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
				dimensions: ['page'],
				dateRange: { start: FAR, end: NOON },
			}
			const expected = await engine.read({ ...filtered, dateRange: upToNow(20260928) })
			const answered = await engine.read(filtered)
			expect({ rows: answered.rows, totals: answered.totals }).toEqual({
				rows: expected.rows,
				totals: expected.totals,
			})
		}
	})

	it('reads nothing for a scope with no hits and no days, whatever its range', async () => {
		const ready = await rig({ rawDays: null })
		const { store, starts } = probed(ready.store)
		const engine = engineOver(store, ready.state, { rawDays: null })
		const far = await engine.read({ metrics: COUNTS, dateRange: { start: FAR, end: NOON } })
		expect(far.totals).toMatchObject({ pageviews: 0, visitors: 0 })
		expect(starts).toEqual([])
	})
})

describe('leased day runs and options', () => {
	it('aggregates only a closed day, and snapshots a running one', async () => {
		const ready = await rig({}, HISTORY)
		await expect(ready.engine.aggregate({ scope: '', day: TODAY, tz: 'UTC' })).rejects.toThrow(
			/has not closed yet/
		)
		expect(await ready.engine.snapshot({ scope: '', day: TODAY, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		expect(await ready.engine.aggregate({ scope: '', day: 20261001, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
	})

	it('refuses an option that is no whole number', async () => {
		await expect(rig({ lazy: { budgetMs: -1 } })).rejects.toThrow(/lazy.budgetMs/)
		await expect(rig({ rawDays: 0 })).rejects.toThrow(/rawDays/)
		await expect(rig({ aggregateDays: 0 })).rejects.toThrow(/aggregateDays/)
		await expect(rig({ maintenance: { runner: true, intervalMs: 0 } })).rejects.toThrow(
			/maintenance.intervalMs/
		)
	})
})

describe('maintenance through the engine', () => {
	it('counts every due closed day, oldest first, and leaves today to reads', async () => {
		const ready = await rig({}, HISTORY)
		const report = await ready.engine.maintain({ budgetMs: 60_000, heartbeat: true })
		expect(report).toMatchObject({ ran: true, finished: true, failed: 0 })
		expect(report.aggregated).toBe(9)
		const markers = await ready.state.markers('', 20260928, TODAY)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			...daysFrom(20260928, 20261005).map((day) => [day, 'final']),
			[20261006, 'provisional'],
		])
		expect(await ready.state.lastBeat('analytics-maintain')).toEqual(NOON)
	})

	it('reclassifies hits of an older taxonomy and marks the days they fall on dirty', async () => {
		const ready = await rig({}, [
			{
				id: 'R1',
				scope: '',
				ts: new Date('2026-10-05T09:00:00.000Z'),
				type: 'pageview',
				hostname: 'a.example',
				path: '/',
				v: 'old-classified-v',
				landing: true,
				server: false,
				ref: 'google.com',
				source: 'google.com',
				channel: 'referral',
				channelVersion: 0,
			},
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		const report = await ready.engine.rebuild({
			from: calendarDayStart(20261005, 'UTC'),
			to: calendarDayStart(20261006, 'UTC'),
			reclassify: true,
		})
		expect(report).toEqual({ reclassified: 1, dirty: 1 })
		const [dirty] = await ready.state.markers('', 20261005, 20261005)
		expect(dirty?.status).toBe('dirty')
		const byChannel = await ready.engine.read({
			metrics: ['pageviews'],
			dimensions: ['channel'],
			dateRange: range(20261005, 20261005),
		})
		expect(byChannel.rows).toEqual([
			{ dimensions: { channel: 'organic-search' }, metrics: { pageviews: 1 } },
		])
	})

	it('starts no background work once closed, and a maintenance run then never runs', async () => {
		const ready = await rig({ maintenance: { runner: false } }, HISTORY)
		await ready.engine.close()
		ready.engine.nudge()
		await ready.engine.idle()
		expect(await ready.state.markers('', 20260928, TODAY)).toEqual([])
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({ ran: false })
	})
})

describe('statements that hold up the thread', () => {
	/** A store whose statements block for at most `stall` ms, and whose 4 October holds `big` hits. */
	const blocking = (store: EventStore, stall: number | null, big = 1_000): EventStore => ({
		...store,
		blockingBudgetMs: async () => stall,
		countHits: async (window, atMost) =>
			window.start.getTime() === calendarDayStart(20261004, 'UTC').getTime()
				? Math.min(big, atMost + 1)
				: store.countHits(window, atMost),
	})
	const query: AnalyticsQuery = { metrics: COUNTS, dateRange: range(20261003, 20261005) }

	it('counts no uncounted day a statement would take longer than the bound for, and reads none raw', async () => {
		const ready = await rig({}, HISTORY)
		const bounded = engineOver(blocking(ready.store, 1), ready.state, {
			maintenance: { runner: false },
		})
		const result = await bounded.read(query)
		expect(result.meta.partial).toEqual({ missingDays: 1 })
		const markers = await ready.state.markers('', 20261003, 20261005)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20261003, 'final'],
			[20261005, 'final'],
		])
		const unbounded = engineOver(blocking(ready.store, null), ready.state, {
			maintenance: { runner: false },
		})
		expect((await unbounded.read(query)).meta.partial).toBeUndefined()
	})

	it('retakes no snapshot of today in the background that would hold the thread past the bound', async () => {
		const ready = await rig({}, HISTORY)
		const today = { metrics: ['pageviews'], dateRange: upToNow(TODAY) } satisfies AnalyticsQuery
		const huge: EventStore = {
			...blocking(ready.store, 1),
			countHits: async (_window, atMost) => atMost + 1,
		}
		const bounded = engineOver(huge, ready.state, { today: { snapshotAboveHits: 0 } })
		await bounded.read(today)
		await bounded.idle()
		expect(await ready.state.markers('', TODAY, TODAY)).toEqual([])
		const unbounded = engineOver({ ...huge, blockingBudgetMs: async () => null }, ready.state, {
			today: { snapshotAboveHits: 0 },
		})
		await unbounded.read(today)
		await unbounded.idle()
		const [snapshot] = await ready.state.markers('', TODAY, TODAY)
		expect(snapshot?.status).toBe('partial')
	})

	it('leaves the counts ingest’s maintenance cannot fit to the job, saying so once', async () => {
		const ready = await rig({}, HISTORY)
		const warnings: string[] = []
		const engine = engineOver(blocking(ready.store, 1), ready.state, {
			maintenance: { runner: false },
			warn: (message) => warnings.push(message),
		})
		engine.nudge()
		await engine.idle()
		const statuses = async () =>
			(await ready.state.markers('', 20261003, 20261005)).map((marker) => marker.status)
		expect(await statuses()).toEqual(['final', 'open', 'final'])
		expect(warnings).toEqual([
			expect.stringMatching(/left 1 count\(s\) to the analytics-maintain job/),
		])
		const job = await engine.maintain({ budgetMs: 60_000 })
		expect(job.deferred).toBe(0)
		expect(await statuses()).toEqual(['final', 'final', 'final'])
	})
})

describe('money', () => {
	const sale = (
		id: string,
		at: string,
		money: { value: number; currency: string; original?: [number, string] }
	): HitRow => ({
		id,
		scope: '',
		ts: new Date(at),
		type: 'goal',
		name: 'purchase',
		hostname: 'a.example',
		path: '/checkout',
		v: 'buyer-0000000001',
		landing: false,
		server: false,
		value: money.value,
		currency: money.currency,
		...(money.original
			? { originalValue: money.original[0], originalCurrency: money.original[1] }
			: {}),
		conversions: 1,
		revenue: money.value,
		goals: [
			{
				slug: 'purchase',
				value: money.value,
				...(money.original ? { sent: money.original[0] } : {}),
			},
		],
	})
	const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_1' }))
	const server = serverTwinOf(wire) ?? ''

	it('counts a closed day again once the server records a sale its browser record is on', async () => {
		const ready = await rig({}, [
			sale(wire, '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		const read = async () =>
			(
				await ready.engine.read({
					metrics: ['conversions', 'revenue'],
					dateRange: range(20261005, 20261005),
				})
			).totals
		expect(await read()).toEqual({ conversions: 1, revenue: 30 })
		await ready.store.append([
			{
				...sale(server, '2026-10-06T09:00:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		await ready.engine.orderStored('', server)
		expect((await ready.state.markers('', 20261005, 20261005))[0]?.status).toBe('dirty')
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(await read()).toEqual({ conversions: 1, revenue: 32 })
	})

	it("takes the browser record's sale away, the server counting its own, once the two lie more than a day apart", async () => {
		const ready = await rig({}, [
			sale(wire, '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		await ready.store.append([
			{
				...sale(server, '2026-10-06T10:00:01.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		await ready.engine.orderStored('', server)
		await ready.engine.maintain({ budgetMs: 60_000 })
		const read = async (first: CalendarDay, last: CalendarDay) =>
			(
				await ready.engine.read({
					metrics: ['conversions', 'revenue', 'events'],
					dateRange: range(first, last),
				})
			).totals
		expect(await read(20261005, 20261005)).toEqual({ conversions: 0, revenue: 0, events: 1 })
		expect(await read(20261005, 20261006)).toEqual({ conversions: 1, revenue: 32, events: 2 })
	})

	it("finds the browser record's day by the count that holds it, in the zone that count was made in", async () => {
		const ready = await rig({ timezone: async () => 'Pacific/Kiritimati' }, [
			sale(wire, '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		await ready.store.append([
			{
				...sale(server, '2026-10-05T12:00:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		await ready.engine.orderStored('', server)
		const markers = await ready.state.markers('', 20261005, 20261006)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([[20261005, 'dirty']])
	})

	it("counts the server record's closed day again once the browser record of its sale arrives", async () => {
		const ready = await rig({}, [
			{
				...sale(server, '2026-10-05T23:59:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		const read = async (day: CalendarDay) =>
			(
				await ready.engine.read({
					metrics: ['conversions', 'revenue'],
					dateRange: range(day, day),
				})
			).totals
		expect(await read(20261005)).toEqual({ conversions: 1, revenue: 32 })
		await ready.store.append([
			sale(wire, '2026-10-06T00:01:00.000Z', { value: 30, currency: 'EUR' }),
		])
		await ready.engine.orderStored('', wire)
		expect((await ready.state.markers('', 20261005, 20261005))[0]?.status).toBe('dirty')
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(await read(20261005)).toEqual({ conversions: 0, revenue: 0 })
		expect(await read(20261006)).toEqual({ conversions: 1, revenue: 32 })
	})

	it('leaves a day still running, one past raw retention and a sale the browser never sent', async () => {
		const ready = await rig({ rawDays: 3 }, [
			sale(wire, '2026-10-07T10:00:00.000Z', { value: 30, currency: 'EUR' }),
			sale(
				orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_old' })),
				'2026-10-01T10:00:00.000Z',
				{ value: 30, currency: 'EUR' }
			),
		])
		await ready.state.ensureMarkers([
			{ scope: '', day: TODAY, tz: 'UTC' },
			{ scope: '', day: 20261001, tz: 'UTC' },
		])
		await ready.engine.aggregate({ scope: '', day: 20261001, tz: 'UTC' })
		await ready.state.recordPruned('', new Date('2026-10-05T00:00:00.000Z'))
		await ready.engine.orderStored('', server)
		await ready.engine.orderStored(
			'',
			orderHitId(dedupeKeyFor({ origin: 'server', goal: 'purchase', orderId: 'ord_old' }))
		)
		await ready.engine.orderStored(
			'',
			orderHitId(dedupeKeyFor({ origin: 'server', goal: 'purchase', orderId: 'ord_none' }))
		)
		const markers = await ready.state.markers('', 20261001, TODAY)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20261001, 'final'],
			[TODAY, 'open'],
		])
	})

	it("files a refund where its sale counts: the browser record's visit, acquired at its latest landing", async () => {
		const landing: HitRow = {
			id: '01J9ZQ0000000000000000LAND',
			scope: '',
			ts: new Date('2026-10-05T09:00:00.000Z'),
			type: 'pageview',
			hostname: 'a.example',
			path: '/offer',
			v: 'buyer-0000000001',
			landing: true,
			server: false,
			ref: 'news.example',
			source: 'news',
			channel: 'email',
			channelVersion: 2,
			utmCampaign: 'fall',
		}
		const ready = await rig({}, [
			landing,
			{
				...sale(wire, '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
				source: 'direct',
				channel: 'direct',
				country: 'DE',
				device: 'mobile',
			},
			{
				...sale(server, '2026-10-05T10:01:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		expect(await ready.engine.saleAttribution('', { wire, server })).toEqual({
			ref: 'news.example',
			source: 'news',
			channel: 'email',
			channelVersion: 2,
			utmCampaign: 'fall',
			country: 'DE',
			device: 'mobile',
		})
		const unknown = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'none' }))
		expect(await ready.engine.saleAttribution('', { wire: unknown, server: 'os.none' })).toEqual({})
	})

	it("files a refund beside the server's own sale when the browser's record is too far from it", async () => {
		const ready = await rig({}, [
			sale(wire, '2026-10-03T10:00:00.000Z', { value: 30, currency: 'EUR' }),
			{
				...sale(server, '2026-10-05T10:00:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
				utmSource: 'partner',
			},
		])
		expect(await ready.engine.saleAttribution('', { wire, server })).toEqual({
			utmSource: 'partner',
		})
	})

	it("counts the raw floor's own day again, whose raw hits pruning keeps", async () => {
		const ready = await rig({ rawDays: 3 }, [
			sale(wire, '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
		])
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		await ready.state.recordPruned('', new Date('2026-10-05T00:00:00.000Z'))
		await ready.store.append([
			{
				...sale(server, '2026-10-05T11:00:00.000Z', { value: 32, currency: 'EUR' }),
				v: '',
				server: true,
			},
		])
		await ready.engine.orderStored('', server)
		expect((await ready.state.markers('', 20261005, 20261005))[0]?.status).toBe('dirty')
	})

	const MIXED = [
		sale('M1', '2026-10-05T10:00:00.000Z', { value: 30, currency: 'EUR' }),
		sale('M2', '2026-10-05T11:00:00.000Z', { value: 40, currency: 'USD' }),
		sale('M3', '2026-10-07T10:00:00.000Z', { value: 5, currency: 'GBP' }),
	]
	const read = (ready: Rig, more: Partial<AnalyticsQuery> = {}) =>
		ready.engine.read({ metrics: ['revenue'], dateRange: upToNow(20261005), ...more })

	it('names the currencies a revenue figure adds when nothing converts them, closed days and today', async () => {
		const ready = await rig({}, MIXED)
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		const result = await read(ready)
		expect(result.totals).toEqual({ revenue: 75 })
		expect(result.meta.mixedCurrencies).toEqual(['EUR', 'GBP', 'USD'])
		expect((await read(ready, { metrics: ['pageviews'] })).meta).not.toHaveProperty(
			'mixedCurrencies'
		)
	})

	it('names none for one currency, a read of one currency, or a scope reporting in its own', async () => {
		const single = await rig({}, [
			MIXED[0] ?? sale('X', '2026-10-05T10:00:00.000Z', { value: 1, currency: 'EUR' }),
		])
		expect((await read(single)).meta).not.toHaveProperty('mixedCurrencies')
		const mixed = await rig({}, MIXED)
		const usd = await read(mixed, {
			filters: [{ dimension: 'currency', operator: 'eq', value: 'USD' }],
		})
		expect(usd.totals).toEqual({ revenue: 40 })
		expect(usd.meta).not.toHaveProperty('mixedCurrencies')
		const converted = await rig({ currency: async () => 'EUR' }, MIXED)
		expect((await read(converted)).meta).not.toHaveProperty('mixedCurrencies')
		const several = await read(converted, {
			filters: [{ dimension: 'currency', operator: 'contains', value: 'sd' }],
		})
		expect(several.totals).toEqual({ revenue: 40 })
		expect(several.meta).not.toHaveProperty('mixedCurrencies')
		const both = await read(converted, {
			filters: [{ dimension: 'currency', operator: 'matches', value: '^(EUR|USD)$' }],
		})
		expect(both.meta.mixedCurrencies).toEqual(['EUR', 'USD'])
	})

	it('reads a currency as sent from its rows exactly as from its raw hits', async () => {
		const hits = [
			sale('C1', '2026-10-05T10:00:00.000Z', { value: 0, currency: 'EUR', original: [80, 'USD'] }),
			sale('C2', '2026-10-05T11:00:00.000Z', { value: 20, currency: 'EUR' }),
			sale('C3', '2026-10-06T10:00:00.000Z', { value: 9, currency: 'EUR', original: [10, 'USD'] }),
		]
		const ready = await rig({}, hits)
		await ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		await ready.engine.aggregate({ scope: '', day: 20261006, tz: 'UTC' })
		const query: AnalyticsQuery = {
			metrics: ['conversions', 'revenue'],
			dateRange: range(20261005, 20261006),
			filters: [{ dimension: 'currency', operator: 'eq', value: 'USD' }],
			granularity: 'day',
		}
		const expected = await rawAnswer(ready.store, query, { scope: '', tz: 'UTC' })
		expect(await answerOf(ready.engine, query)).toEqual(expected)
		expect(expected.totals).toEqual({ conversions: 2, revenue: 90 })
		const byCurrency = await ready.engine.read({
			metrics: ['conversions', 'revenue'],
			dimensions: ['currency'],
			dateRange: range(20261005, 20261006),
			order: { metric: 'revenue', direction: 'desc' },
		})
		expect(byCurrency.rows.map((row) => [row.dimensions?.currency, row.metrics.revenue])).toEqual([
			['USD', 90],
			['EUR', 20],
		])
		expect(byCurrency.totals).toEqual({ conversions: 3, revenue: 29 })
	})
})
