import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'
import { AnalyticsTrackError } from '../../core/serverEvent'
import { InvalidQueryError } from '../../core/sourceErrors'
import { type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import type { EventStore, HitRow } from '../store/types'
import { localDay } from './days'
import { createEngine, type EngineOptions, type NativeEngine } from './engine'

const NOON = new Date('2026-10-07T12:00:00.000Z')

let serial = 0

const pv = (ts: string, more: Partial<HitRow> = {}): HitRow => {
	serial += 1
	return {
		id: `Z${String(serial).padStart(9, '0')}`,
		scope: '',
		ts: new Date(ts),
		type: 'pageview',
		hostname: 'a.example',
		path: '/',
		v: `z${serial}`.padEnd(16, 'x'),
		landing: true,
		server: false,
		source: 'direct',
		channel: 'direct',
		...more,
	}
}

/** One store and state, engines built on them as separate processes would be. */
const shared = (clock = { at: NOON }) => {
	const now = () => new Date(clock.at.getTime())
	const state = memoryStateStore({ now })
	const store = memoryEventStore({ state, now })
	const warnings: string[] = []
	const engineWith = (options: EngineOptions = {}): NativeEngine =>
		createEngine({
			payload: { logger: { warn: () => undefined } } as unknown as Payload,
			store,
			state,
			options: { now, warn: (message) => warnings.push(message), ...options },
		})
	return { store, state, engineWith, clock, warnings }
}

const days = (from: CalendarDay, to: CalendarDay, tz = 'UTC'): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: new Date(localDay(to, tz).end.getTime() - 1),
})

const series = async (engine: NativeEngine, query: AnalyticsQuery) =>
	(await engine.read(query)).rows.map((row) => [row.timestamp, row.metrics.pageviews])

describe('a zone change at the raw floor', () => {
	// Seven hits, three days of raw hits kept: the first run prunes the oldest three in the old zone.
	const hits = () => [
		pv('2026-10-03T12:00:00.000Z'),
		pv('2026-10-04T16:00:00.000Z'),
		pv('2026-10-04T20:00:00.000Z'),
		pv('2026-10-05T10:00:00.000Z'),
		pv('2026-10-05T18:00:00.000Z'),
		pv('2026-10-06T10:00:00.000Z'),
		pv('2026-10-07T01:00:00.000Z'),
	]

	const change = async (from: string, to: string, readOnTheDay: boolean) => {
		const zone = { tz: from }
		const rig = shared({ at: NOON })
		const engine = rig.engineWith({
			rawDays: 3,
			timezone: () => zone.tz,
			maintenance: { runner: true },
		})
		await rig.store.append(hits())
		await engine.maintain({ budgetMs: 60_000 })
		zone.tz = to
		const query: AnalyticsQuery = {
			metrics: ['pageviews'],
			granularity: 'day',
			dateRange: days(20261004, 20261006, to),
		}
		const early = readOnTheDay ? await series(engine, query) : null
		await engine.maintain({ budgetMs: 60_000 })
		rig.clock.at = new Date('2026-10-08T12:00:00.000Z')
		await engine.maintain({ budgetMs: 60_000 })
		return { early, late: await series(engine, query), state: rig.state }
	}

	it('east, UTC to Tokyo: the first day counted in Tokyo starts where the last UTC one ended', async () => {
		const expected = [
			['2026-10-03T15:00:00.000Z', 2],
			['2026-10-04T15:00:00.000Z', 1],
			['2026-10-05T15:00:00.000Z', 2],
		]
		const read = await change('UTC', 'Asia/Tokyo', true)
		const quiet = await change('UTC', 'Asia/Tokyo', false)
		expect(read.early).toEqual(expected)
		expect(read.late).toEqual(expected)
		expect(quiet.late).toEqual(expected)
		const [seam] = await quiet.state.markers('', 20261005, 20261005)
		expect([seam?.tz, seam?.start?.toISOString()]).toEqual([
			'Asia/Tokyo',
			'2026-10-05T00:00:00.000Z',
		])
	})

	it('west, Tokyo to UTC: the first day counted in UTC starts where the last Tokyo one ended', async () => {
		const expected = [
			['2026-10-04T00:00:00.000Z', 2],
			['2026-10-05T00:00:00.000Z', 2],
			['2026-10-06T00:00:00.000Z', 1],
		]
		const read = await change('Asia/Tokyo', 'UTC', true)
		const quiet = await change('Asia/Tokyo', 'UTC', false)
		expect(read.early).toEqual(expected)
		expect(read.late).toEqual(expected)
		expect(quiet.late).toEqual(expected)
	})

	it('records the cut before the raw hits it deletes, never moving it back', async () => {
		const rig = shared()
		const engine = rig.engineWith({ rawDays: 3, maintenance: { runner: true } })
		await rig.store.append(hits())
		await engine.maintain({ budgetMs: 60_000 })
		expect(await rig.state.prunedBefore('')).toEqual(new Date('2026-10-05T00:00:00.000Z'))
		await rig.state.recordPruned('', new Date('2026-10-01T00:00:00.000Z'))
		expect(await rig.state.prunedBefore('')).toEqual(new Date('2026-10-05T00:00:00.000Z'))
	})
})

describe('a scope whose zone does not resolve', () => {
	const failing = (): string => {
		throw new Error('tenant lookup failed')
	}

	it('keeps the zone its newest counted day was counted in, in a process that never resolved it', async () => {
		const rig = shared()
		await rig.store.append([
			pv('2026-10-04T20:00:00.000Z'),
			pv('2026-10-05T10:00:00.000Z'),
			pv('2026-10-05T20:00:00.000Z'),
		])
		await rig.engineWith({ timezone: () => 'Asia/Tokyo' }).maintain({ budgetMs: 60_000 })
		const fresh = rig.engineWith({ timezone: failing })
		const answer = await fresh.read({
			metrics: ['pageviews'],
			granularity: 'day',
			dateRange: days(20261004, 20261006, 'Asia/Tokyo'),
		})
		await fresh.idle()
		expect(answer.meta.timezoneUnresolved).toBeUndefined()
		expect(answer.rows.map((row) => row.metrics.pageviews)).toEqual([2, 1])
		const markers = await rig.state.markers('', 20261004, 20261006)
		expect(markers.every((marker) => marker.tz === 'Asia/Tokyo')).toBe(true)
	})

	it('is read in UTC with none ever recorded, writing nothing and saying so', async () => {
		const rig = shared()
		// Nine days with hits: seven are read raw, the rest missing, none counted for later.
		await rig.store.append(
			[
				'2026-09-28',
				'2026-09-29',
				'2026-09-30',
				'2026-10-01',
				'2026-10-02',
				'2026-10-03',
				'2026-10-04',
				'2026-10-05',
				'2026-10-06',
			].map((day) => pv(`${day}T10:00:00.000Z`))
		)
		const engine = rig.engineWith({ timezone: failing })
		const answer = await engine.read({
			metrics: ['pageviews'],
			dateRange: days(20260920, 20261007),
		})
		await engine.idle()
		expect(answer.totals).toEqual({ pageviews: 7 })
		expect(answer.meta.timezoneUnresolved).toBe(true)
		expect(answer.meta.partial).toEqual({ missingDays: 2 })
		expect(await rig.state.markers('', 20260901, 20261031)).toEqual([])
	})

	it('is still pruned by a cut no zone’s floor comes before, with a warning every run', async () => {
		const rig = shared()
		await rig.store.append([
			pv('2026-09-01T10:00:00.000Z', { scope: 'broken' }),
			pv('2026-10-03T23:00:00.000Z', { scope: 'broken' }),
			pv('2026-10-06T10:00:00.000Z', { scope: 'broken' }),
		])
		const engine = rig.engineWith({ scoped: true, rawDays: 3, timezone: failing })
		const report = await engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedHits).toBe(2)
		expect(await rig.store.oldestHit('broken')).toEqual(new Date('2026-10-06T10:00:00.000Z'))
		expect(await rig.state.prunedBefore('broken')).toEqual(new Date('2026-10-04T10:00:00.000Z'))
		await engine.maintain({ budgetMs: 60_000 })
		expect(rig.warnings.filter((message) => message.includes('has never resolved'))).toHaveLength(2)
		expect(await rig.state.markers('broken', 20260901, 20261031)).toEqual([])
	})
})

describe('every scope', () => {
	it('includes a scope whose raw hits are all pruned, in reads and in aggregate pruning', async () => {
		const rig = shared({ at: new Date('2026-09-10T12:00:00.000Z') })
		await rig.store.append([
			pv('2026-09-01T10:00:00.000Z', { scope: 'gone' }),
			pv('2026-09-01T11:00:00.000Z', { scope: 'live' }),
		])
		const engine = rig.engineWith({
			scoped: true,
			rawDays: 3,
			aggregateDays: 60,
			timezone: () => 'UTC',
		})
		await engine.maintain({ budgetMs: 60_000 })
		expect(await rig.store.scopes()).toEqual([])
		rig.clock.at = NOON
		await rig.store.append([pv('2026-10-06T10:00:00.000Z', { scope: 'live' })])
		const query: AnalyticsQuery = { metrics: ['pageviews'], dateRange: days(20260901, 20261007) }
		expect((await engine.read(query)).totals).toEqual({ pageviews: 3 })
		expect((await engine.read({ ...query, scope: 'gone' })).totals).toEqual({ pageviews: 1 })
		rig.clock.at = new Date('2026-11-15T12:00:00.000Z')
		const report = await engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedAggregates).toBeGreaterThan(0)
		expect(await rig.state.markers('gone', 20260901, 20260916)).toEqual([])
		const [left] = await rig.store.readAggregates({
			scope: 'gone',
			days: [[20260901, 20261115]],
			dim: '',
			groupBy: 'total',
		})
		expect(left?.parts.pageviews).toBe(0)
	})
})

describe('days past aggregateDays', () => {
	it('are said to be gone, rather than read as zeros', async () => {
		const rig = shared()
		const engine = rig.engineWith({ rawDays: 3, aggregateDays: 10 })
		const answer = await engine.read({
			metrics: ['pageviews'],
			dateRange: days(20260901, 20261006),
		})
		expect(answer.meta).toMatchObject({
			clamped: true,
			dataFrom: '2026-09-28T00:00:00.000Z',
		})
	})
})

describe('reads a source never counts', () => {
	it('refuses goal completions broken down by item as an invalid query', async () => {
		const engine = shared().engineWith()
		await expect(
			engine.read({
				metrics: ['conversions'],
				dimensions: ['item'],
				filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
				dateRange: days(20261005, 20261006),
			})
		).rejects.toBeInstanceOf(InvalidQueryError)
	})
})

describe('a server hit dated on a closed day', () => {
	const order = (ts: string, id: string, revenue: number): HitRow => ({
		...pv(ts),
		id,
		type: 'goal',
		v: '',
		landing: false,
		server: true,
		name: 'purchase',
		path: '/orders',
		conversions: 1,
		revenue,
		goals: [{ slug: 'purchase', value: revenue }],
	})

	/** What server tracking does with a hit: places it, stores it, reopens a closed day. */
	const land = async (on: { store: EventStore; engine: NativeEngine }, hit: HitRow) => {
		const day = await on.engine.serverHitDay('', hit.ts)
		await on.store.append([hit])
		if (day?.closed) {
			await on.engine.reopen(day)
		}
		return day
	}

	it('reopens its day, final or empty, so the next count holds it', async () => {
		const rig = shared()
		const engine = rig.engineWith({ maintenance: { runner: true } })
		await rig.store.append([pv('2026-10-03T09:00:00.000Z')])
		await engine.maintain({ budgetMs: 60_000 })
		const query: AnalyticsQuery = {
			metrics: ['conversions', 'revenue', 'pageviews'],
			dateRange: days(20261002, 20261003),
		}
		const before = await engine.read(query)
		await engine.idle()
		const [empty] = await rig.state.markers('', 20261002, 20261002)
		expect(empty?.status).toBe('empty')
		const late = await land(
			{ store: rig.store, engine },
			order('2026-10-02T10:00:00.000Z', 'os.late-1', 70)
		)
		expect(late).toMatchObject({ day: 20261002, tz: 'UTC', closed: true })
		await land({ store: rig.store, engine }, order('2026-10-03T10:00:00.000Z', 'os.late-2', 100))
		await engine.maintain({ budgetMs: 60_000 })
		expect(before.totals).toEqual({ conversions: 0, revenue: 0, pageviews: 1 })
		expect((await engine.read(query)).totals).toEqual({
			conversions: 2,
			revenue: 170,
			pageviews: 1,
		})
	})

	it('is refused on or before the raw floor day, whose raw hits may be pruned', async () => {
		const engine = shared().engineWith({ rawDays: 5 })
		await expect(
			engine.serverHitDay('', new Date('2026-10-03T23:59:00.000Z'))
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(await engine.serverHitDay('', new Date('2026-10-04T00:00:00.000Z'))).toMatchObject({
			day: 20261004,
			closed: true,
		})
		expect(await engine.serverHitDay('', NOON)).toMatchObject({ day: 20261007, closed: false })
		const keepAll = shared().engineWith({ rawDays: null })
		expect(await keepAll.serverHitDay('', new Date('2020-01-01T00:00:00.000Z'))).toMatchObject({
			day: 20200101,
		})
	})
})
