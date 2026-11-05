import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery, MetricKey } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { createEngine, type EngineOptions, type NativeEngine } from '../../src/native/engine/engine'
import { rawAnswer } from '../../src/native/engine/rawAnswer'
import { native } from '../../src/native/nativeAdapter'
import { dayWindow } from '../../src/native/store/aggregate'
import { DEFAULT_CAPS } from '../../src/native/store/caps'
import { createEventStore, type EventStoreOptions } from '../../src/native/store/eventStore'
import { DAY_LEASE_MS, dayEnd, dayKey } from '../../src/native/store/state'
import { createStateStore } from '../../src/native/store/stateStore'
import type { EventStore, HitRow, StateStore } from '../../src/native/store/types'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { previousWindow } from '../../src/timeframe/comparison'
import { pagesDay, siteDay } from './engineHits'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

/** Mid-afternoon in Berlin, late morning in New York, already evening in Tokyo. */
const NOW = new Date('2026-10-07T15:00:00.000Z')
const clock = { at: NOW }
const now = (): Date => new Date(clock.at.getTime())

const ZONES: Record<string, string> = {
	alpha: 'Europe/Berlin',
	beta: 'America/New_York',
	gamma: 'UTC',
	delta: 'Asia/Tokyo',
	epsilon: 'UTC',
	zeta: 'UTC',
}
const zoneOf = (scope: string): string => ZONES[scope] ?? 'UTC'

/** Local dates of a scope's zone, from `from` through today there. */
const datesThrough = (from: CalendarDay, tz: string): CalendarDay[] => {
	const today = Number(
		new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(NOW).replaceAll('-', '')
	)
	const days: CalendarDay[] = []
	for (let day = from; day <= today; day = addCalendarDays(day, 1)) {
		days.push(day)
	}
	return days
}

const visits = (scope: string, from: CalendarDay, people?: number): HitRow[] => {
	const tz = zoneOf(scope)
	return datesThrough(from, tz).flatMap((day) =>
		siteDay({ scope, day, tz, until: NOW, ...(people === undefined ? {} : { people }) })
	)
}

const HITS: HitRow[] = [
	...visits('alpha', 20260928),
	...visits('beta', 20260930),
	...visits('gamma', 20261001, 3),
	...visits('delta', 20261004, 3),
	...visits('epsilon', 20261006, 20),
	...[20261005, 20261006].flatMap((day) =>
		pagesDay({ scope: 'zeta', day, tz: 'UTC', pages: 60, views: (index) => 60 - index })
	),
	...pagesDay({
		scope: 'zeta',
		day: 20261007,
		tz: 'UTC',
		pages: 60,
		views: (index) => (index === 59 ? 200 : index === 0 ? 1 : 0),
		until: NOW,
	}),
]

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
const DIMENSIONS = [
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

/** Whole local days, the last instant of the last one included, as a custom range reads. */
const days = (from: CalendarDay, to: CalendarDay, tz: string): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: new Date(dayEnd(to, tz).getTime() - 1),
})

/** From a local day's start up to now, as the presets read. */
const toNow = (from: CalendarDay, tz: string): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: now(),
})

/** Every question the view, the widgets and the document panel ask, for one scope in its zone. */
const battery = (scope: string, from: CalendarDay): Array<[string, AnalyticsQuery]> => {
	const timezone = zoneOf(scope)
	const today = datesThrough(from, timezone).at(-1) ?? from
	const base = { scope, timezone, dateRange: toNow(from, timezone) }
	const closed = days(addCalendarDays(today, -3), addCalendarDays(today, -1), timezone)
	const previous = previousWindow(closed, timezone)
	if (!previous) {
		throw new Error('no previous window')
	}
	return [
		['totals', { ...base, metrics: EVERYTHING }],
		['by day', { ...base, metrics: EVERYTHING, granularity: 'day' }],
		['by week', { ...base, metrics: EVERYTHING, granularity: 'week' }],
		['by month', { ...base, metrics: EVERYTHING, granularity: 'month' }],
		['three closed days', { ...base, metrics: EVERYTHING, dateRange: closed }],
		['the days before them', { ...base, metrics: EVERYTHING, dateRange: previous }],
		[
			'today by the hour',
			{ ...base, metrics: COUNTS, granularity: 'hour', dateRange: toNow(today, timezone) },
		],
		...DIMENSIONS.map((dimension): [string, AnalyticsQuery] => [
			`by ${dimension}`,
			{ ...base, metrics: [...COUNTS, 'bounceRate'], dimensions: [dimension] },
		]),
		[
			'items',
			{
				...base,
				metrics: ['impressions', 'interactions', 'visitors', 'conversions'],
				dimensions: ['item'],
			},
		],
		[
			'top pages by visitors',
			{
				...base,
				metrics: COUNTS,
				dimensions: ['page'],
				order: { metric: 'visitors', direction: 'desc' },
				limit: 3,
			},
		],
		[
			'sources by bounce rate',
			{
				...base,
				metrics: ['bounceRate', 'sessions'],
				dimensions: ['source'],
				order: { metric: 'bounceRate', direction: 'asc' },
			},
		],
		[
			'google by day',
			{
				...base,
				metrics: EVERYTHING,
				filters: [{ dimension: 'source', operator: 'eq', value: 'google' }],
				granularity: 'day',
			},
		],
		['one page', { ...base, metrics: EVERYTHING, path: '/pricing' }],
		...(['channel', 'source', 'utmCampaign'] as const).map(
			(dimension): [string, AnalyticsQuery] => [
				`purchases by ${dimension}`,
				{
					...base,
					metrics: ['conversions', 'revenue', 'visitors'],
					dimensions: [dimension],
					filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
				},
			]
		),
		[
			'an item',
			{
				...base,
				metrics: ['impressions', 'interactions', 'visitors', 'events', 'conversions', 'revenue'],
				item: 'offers:1',
			},
		],
		['an item by day', { ...base, metrics: ['impressions'], item: 'offers:1', granularity: 'day' }],
		[
			'the pages of an item',
			{ ...base, metrics: ['impressions', 'interactions'], dimensions: ['page'], item: 'offers:2' },
		],
		[
			'the countries of an item clicks',
			{
				...base,
				metrics: ['visitors', 'interactions'],
				dimensions: ['country'],
				filters: [{ dimension: 'item', operator: 'eq', value: 'offers:1' }],
			},
		],
		[
			'a filter beside a breakdown',
			{
				...base,
				metrics: COUNTS,
				dimensions: ['page'],
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			},
		],
		[
			'a contains filter by week',
			{
				...base,
				metrics: EVERYTHING,
				filters: [{ dimension: 'page', operator: 'contains', value: 'BLOG' }],
				granularity: 'week',
			},
		],
		[
			'one hostname by day',
			{ ...base, metrics: EVERYTHING, hostname: `b.${scope}.example`, granularity: 'day' },
		],
	]
}

/**
 * A read stops counting closed days once its lazy budget (3 s by default) is spent, which a slow CI
 * runner does before the last one; reads compared with raw ones must count every day.
 */
const UNHURRIED: EngineOptions = { lazy: { budgetMs: 120_000 } }

describeForDb('native engine reads', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload
	let store: EventStore
	let state: StateStore
	/** Every engine a test made: its background counting must not write markers into the next test. */
	const started: NativeEngine[] = []

	const engineOn = (
		booted: BootedPayload,
		options: EngineOptions = {},
		storeOptions: EventStoreOptions = {}
	): NativeEngine => {
		const engine = createEngine({
			payload: booted.payload,
			store: createEventStore(booted.payload, { now, ...storeOptions }),
			state: createStateStore(booted.payload, { now }),
			options: { scoped: true, timezone: zoneOf, now, warn: () => undefined, ...options },
		})
		started.push(engine)
		return engine
	}

	afterEach(async () => {
		await Promise.all(started.splice(0).map((engine) => engine.idle()))
	})

	/** The engine's answer beside the one raw reads alone give, for one question. */
	const compare = async (engine: NativeEngine, name: string, query: AnalyticsQuery) => {
		const { rows, totals } = await engine.read(query)
		const expected = await rawAnswer(store, query, {
			scope: query.scope ?? '',
			tz: zoneOf(query.scope ?? ''),
		})
		expect({ name, rows, totals }).toEqual({ name, ...expected })
	}

	beforeAll(async () => {
		first = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: first })
		store = createEventStore(first.payload, { now })
		state = createStateStore(first.payload, { now })
		expect(await store.append(HITS)).toEqual({ written: HITS.length, duplicates: 0 })
	}, 240_000)

	afterAll(async () => {
		await second?.stop()
		await first?.stop()
	})

	it('answers alpha in Berlin as raw reads do: days aggregated before, a stale zone, lazy days and today', async () => {
		const engine = engineOn(first, UNHURRIED)
		for (const day of [20260928, 20260929, 20260930, 20261001]) {
			expect(await engine.aggregate({ scope: 'alpha', day, tz: 'Europe/Berlin' })).toMatchObject({
				outcome: 'completed',
			})
		}
		// 3 October counted in UTC: its marker names another zone than the scope reads in now.
		await state.ensureMarkers([{ scope: 'alpha', day: 20261003, tz: 'UTC' }])
		expect(await state.claim(dayKey('alpha', 20261003), 'utc-run', DAY_LEASE_MS)).toBe(true)
		expect(
			await store.aggregateDay(dayWindow('alpha', 20261003, 'UTC'), {
				runId: 'utc-run',
				caps: DEFAULT_CAPS,
				status: 'final',
			})
		).toMatchObject({ completed: true })
		for (const [name, query] of battery('alpha', 20260928)) {
			await compare(engine, name, query)
		}
		const markers = await state.markers('alpha', 20260928, 20261007)
		expect(markers.map((marker) => [marker.day, marker.tz, marker.status])).toEqual([
			[20260928, 'Europe/Berlin', 'final'],
			[20260929, 'Europe/Berlin', 'final'],
			[20260930, 'Europe/Berlin', 'final'],
			[20261001, 'Europe/Berlin', 'final'],
			[20261002, 'Europe/Berlin', 'final'],
			[20261003, 'Europe/Berlin', 'final'],
			[20261004, 'Europe/Berlin', 'final'],
			[20261005, 'Europe/Berlin', 'final'],
			[20261006, 'Europe/Berlin', 'provisional'],
		])
	}, 180_000)

	it('answers beta in New York as raw reads do, every closed day aggregated during the reads', async () => {
		const engine = engineOn(first, UNHURRIED)
		for (const [name, query] of battery('beta', 20260930)) {
			await compare(engine, name, query)
		}
		const markers = await state.markers('beta', 20260930, 20261007)
		expect(markers.every((marker) => marker.tz === 'America/New_York')).toBe(true)
		expect(markers.map((marker) => marker.day)).toEqual([
			20260930, 20261001, 20261002, 20261003, 20261004, 20261005, 20261006,
		])
	}, 180_000)

	it('reads a busy site today from a snapshot taken in the background, as of when it was taken', async () => {
		const engine = engineOn(first, { today: { snapshotAboveHits: 1 } })
		const query: AnalyticsQuery = {
			scope: 'beta',
			timezone: 'America/New_York',
			metrics: EVERYTHING,
			granularity: 'day',
			dateRange: toNow(20261005, 'America/New_York'),
		}
		const expected = await rawAnswer(store, query, { scope: 'beta', tz: 'America/New_York' })
		const live = await engine.read(query)
		expect(live.meta.asOf).toBeUndefined()
		expect({ rows: live.rows, totals: live.totals }).toEqual(expected)
		await engine.idle()
		const [snapshot] = await state.markers('beta', 20261007, 20261007)
		expect(snapshot).toMatchObject({ status: 'partial', tz: 'America/New_York' })
		const result = await engine.read(query)
		expect(result.meta.asOf).toBe(NOW.toISOString())
		expect({ rows: result.rows, totals: result.totals }).toEqual(expected)
	})

	it('serves a stale snapshot while it takes another, and the next read the new one', async () => {
		const engine = engineOn(first, { today: { snapshotAboveHits: 1, maxAgeMs: 60_000 } })
		/** Today up to the moment it is read, as the today preset asks. */
		const query = (): AnalyticsQuery => ({
			scope: 'beta',
			timezone: 'America/New_York',
			metrics: COUNTS,
			dateRange: toNow(20261007, 'America/New_York'),
		})
		await engine.read(query())
		await engine.idle()
		const later = new Date(NOW.getTime() + 90_000)
		clock.at = later
		try {
			const stale = await engine.read(query())
			expect(stale.meta.asOf).toBe(NOW.toISOString())
			await engine.idle()
			const [snapshot] = await state.markers('beta', 20261007, 20261007)
			expect(snapshot?.aggregatedAt).toEqual(later)
			const fresh = await engine.read(query())
			expect(fresh.meta.asOf).toBe(later.toISOString())
			expect(fresh.totals).toEqual(stale.totals)
		} finally {
			clock.at = NOW
		}
	})

	it.runIf(db === 'sqlite')(
		'reads today from a snapshot once SQLite refuses to read its raw hits in time',
		async () => {
			const engine = engineOn(first, { timeoutMs: 1 })
			const query: AnalyticsQuery = {
				scope: 'epsilon',
				timezone: 'UTC',
				metrics: COUNTS,
				dateRange: toNow(20261007, 'UTC'),
			}
			const refused = await engine.read(query)
			expect(refused.meta.partial).toEqual({ missingDays: 1 })
			await engine.idle()
			const result = await engine.read(query)
			expect(result.meta.asOf).toBe(NOW.toISOString())
			expect(result.meta.partial).toBeUndefined()
			expect(result.totals).toEqual(
				(await rawAnswer(store, query, { scope: 'epsilon', tz: 'UTC' })).totals
			)
		}
	)

	it('fills a page in exactly when today lifts it past the candidates the closed days offered', async () => {
		const engine = engineOn(first, UNHURRIED)
		const query: AnalyticsQuery = {
			scope: 'zeta',
			timezone: 'UTC',
			metrics: ['pageviews', 'visitors'],
			dimensions: ['page'],
			limit: 3,
			dateRange: toNow(20261005, 'UTC'),
		}
		await compare(engine, 'top 3 of 60 pages', query)
		const { rows } = await engine.read(query)
		expect(rows.map((row) => [row.dimensions?.page, row.metrics.pageviews])).toEqual([
			['/page-59', 202],
			['/page-00', 121],
			['/page-01', 118],
		])
	})

	/** Runs `work` while the jobs runner's heartbeat is fresh, and leaves it stale after. */
	const withRunner = async (work: () => Promise<void>): Promise<void> => {
		await state.beat(MAINTAIN_TASK_SLUG)
		try {
			await work()
		} finally {
			clock.at = new Date(NOW.getTime() - 2 * 3_600_000)
			await state.beat(MAINTAIN_TASK_SLUG)
			clock.at = NOW
		}
	}

	it('counts no day while a jobs runner is fresh, reading the newest raw and saying how many it left out', async () => {
		await withRunner(async () => {
			const engine = engineOn(first, { lazy: { rawDays: 1 } })
			const query: AnalyticsQuery = {
				scope: 'gamma',
				timezone: 'UTC',
				metrics: COUNTS,
				dateRange: days(20261001, 20261004, 'UTC'),
			}
			const result = await engine.read(query)
			expect(result.meta.partial).toEqual({ missingDays: 3 })
			expect(result.totals).toEqual(
				(
					await rawAnswer(
						store,
						{ ...query, dateRange: days(20261004, 20261004, 'UTC') },
						{ scope: 'gamma', tz: 'UTC' }
					)
				).totals
			)
			await engine.close()
			expect(await state.markers('gamma', 20261001, 20261004)).toEqual([])
		})
	})

	it('answers within its budget beside a day too big to read in it, and leaves the day out', async () => {
		const engine = engineOn(first)
		expect(await engine.aggregate({ scope: 'gamma', day: 20261002, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		const [counted] = await state.markers('gamma', 20261002, 20261002)
		if (!counted) {
			throw new Error('the day was not counted')
		}
		expect(await state.claim(dayKey('gamma', 20261002), 'huge', DAY_LEASE_MS)).toBe(true)
		expect(await state.complete({ ...counted, hits: 2_000_000_000 }, 'huge')).toBe(true)
		await state.markDirty('gamma', [20261002])
		const query: AnalyticsQuery = {
			scope: 'gamma',
			timezone: 'UTC',
			metrics: COUNTS,
			dateRange: days(20261002, 20261002, 'UTC'),
		}
		await withRunner(async () => {
			const started = Date.now()
			const result = await engine.read(query)
			expect(Date.now() - started).toBeLessThan(3_000)
			expect(result.meta.partial).toEqual({ missingDays: 1 })
			expect(result.totals?.pageviews).toBe(0)
			await engine.close()
		})
		const [left] = await state.markers('gamma', 20261002, 20261002)
		expect(left?.status).toBe('dirty')
		const recount = engineOn(first)
		expect(await recount.aggregate({ scope: 'gamma', day: 20261002, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
	})

	it('lets one of two instances aggregate a missing day while the other reads it raw, both alike', async () => {
		let inside: () => void = () => undefined
		const entered = new Promise<void>((resolve) => {
			inside = resolve
		})
		let release: () => void = () => undefined
		const released = new Promise<void>((resolve) => {
			release = resolve
		})
		const holding = engineOn(
			first,
			{},
			{
				hooks: {
					beforeWrite: async () => {
						inside()
						await released
					},
				},
			}
		)
		const other = engineOn(second)
		const query: AnalyticsQuery = {
			scope: 'delta',
			timezone: 'Asia/Tokyo',
			metrics: EVERYTHING,
			dateRange: days(20261005, 20261005, 'Asia/Tokyo'),
		}
		const holdingRead = holding.read(query)
		await entered
		const [held] = await state.markers('delta', 20261005, 20261005)
		expect(held?.leaseOwner).toMatch(/^engine:/)
		const meanwhile = await other.read(query)
		release()
		const settled = await holdingRead
		// A read can answer before the aggregation it started releases the day's lease.
		await Promise.all([holding.idle(), other.idle()])
		const expected = await rawAnswer(store, query, { scope: 'delta', tz: 'Asia/Tokyo' })
		expect({ rows: meanwhile.rows, totals: meanwhile.totals }).toEqual(expected)
		expect({ rows: settled.rows, totals: settled.totals }).toEqual(expected)
		const [done] = await state.markers('delta', 20261005, 20261005)
		expect(done).toMatchObject({ status: 'final', leaseOwner: null })
		expect((await other.read(query)).totals).toEqual(expected.totals)
	})

	it('reads every scope as the sum of each one over the same instants', async () => {
		const engine = engineOn(first)
		const instants: AnalyticsQuery = {
			metrics: COUNTS,
			timezone: 'UTC',
			dateRange: days(20261003, 20261005, 'UTC'),
		}
		const scopes = Object.keys(ZONES)
		const each = await Promise.all(scopes.map((scope) => engine.read({ ...instants, scope })))
		const every = await engine.read(instants)
		for (const metric of COUNTS) {
			expect(every.totals?.[metric]).toBe(
				each.reduce((sum, part) => sum + (part.totals?.[metric] ?? 0), 0)
			)
		}
		for (const [index, scope] of scopes.entries()) {
			expect(each[index]?.totals).toEqual(
				(await rawAnswer(store, { ...instants, scope }, { scope, tz: zoneOf(scope) })).totals
			)
		}
	}, 180_000)

	it('marks the sealed days without hits empty, and counts the window live by the minute', async () => {
		const engine = engineOn(first)
		const quiet: AnalyticsQuery = {
			scope: 'delta',
			timezone: 'Asia/Tokyo',
			metrics: ['pageviews'],
			dateRange: days(20260925, 20261003, 'Asia/Tokyo'),
		}
		expect((await engine.read(quiet)).totals).toEqual({ pageviews: 0 })
		await engine.idle()
		const empty = await state.markers('delta', 20260925, 20261003)
		expect(empty.map((marker) => [marker.day, marker.status])).toEqual(
			[
				20260925, 20260926, 20260927, 20260928, 20260929, 20260930, 20261001, 20261002, 20261003,
			].map((day) => [day, 'empty'])
		)
		const live = await engine.realtime({
			scope: 'epsilon',
			metrics: ['visitors', 'pageviews'],
			dateRange: { start: new Date(NOW.getTime() - 60 * 60_000), end: NOW },
			granularity: 'minute',
		})
		expect(live.rows).toHaveLength(61)
		const counter = await engine.realtime({
			scope: 'epsilon',
			metrics: ['visitors', 'pageviews'],
			dateRange: { start: new Date(NOW.getTime() - 60 * 60_000), end: NOW },
		})
		expect(counter.rows).toEqual([])
		expect(counter.totals).toEqual(live.totals)
		const direct = await store.realtime({
			scope: 'epsilon',
			start: new Date(NOW.getTime() - 60 * 60_000),
			end: new Date(NOW.getTime() + 1),
			timeoutMs: 20_000,
		})
		expect(live.totals).toEqual({ visitors: direct.visitors, pageviews: direct.pageviews })
	})

	it(`reads a range from the year 1000 as one from the scope's first day, quickly, on ${db}`, async () => {
		const engine = engineOn(first)
		const base = { scope: 'alpha', timezone: zoneOf('alpha'), metrics: COUNTS }
		const near = await engine.read({ ...base, dateRange: toNow(20260928, zoneOf('alpha')) })
		await engine.idle()
		const far: AnalyticsQuery = {
			...base,
			dateRange: { start: new Date('1000-01-01T00:00:00.000Z'), end: now() },
		}
		await engine.read(far)
		const started = performance.now()
		const answered = await engine.read(far)
		const ms = performance.now() - started
		expect(answered.totals).toEqual(near.totals)
		expect(answered.meta.clamped).toBeUndefined()
		expect(ms).toBeLessThan(1_000)
	})
})
