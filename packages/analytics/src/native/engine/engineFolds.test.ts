import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'
import { type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { type CapsOption, resolveCaps } from '../store/caps'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import type { EventStore, HitRow, RawRead } from '../store/types'
import { localDay } from './days'
import { createEngine, type EngineOptions } from './engine'
import { rawAnswer } from './rawAnswer'

const NOON = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000

let serial = 0

const hit = (ts: string, extra: Partial<HitRow> = {}): HitRow => {
	serial += 1
	return {
		id: `F${String(serial).padStart(9, '0')}`,
		scope: '',
		ts: new Date(ts),
		type: 'pageview',
		hostname: 'a.example',
		path: '/',
		v: `f${serial}`.padEnd(16, 'x'),
		landing: true,
		server: false,
		source: 'direct',
		channel: 'direct',
		...extra,
	}
}

/** `count` landings on each path, one visitor each, from the tenth hour of a UTC day on. */
const pages = (day: string, counts: ReadonlyArray<readonly [string, number]>): HitRow[] =>
	counts.flatMap(([path, count], p) =>
		Array.from({ length: count }, (_, i) =>
			hit(`${day}T1${p}:${String(i).padStart(2, '0')}:00.000Z`, { path })
		)
	)

/** A visit landing from `source` that completes `goal` a minute later. */
const sale = (
	day: string,
	{ minute, source, goal }: { minute: number; source: string; goal: string }
): HitRow[] => {
	const at = new Date(calendarDayStart(Number(day.replaceAll('-', '')), 'UTC').getTime())
	const landing = hit(new Date(at.getTime() + (600 + minute) * MINUTE).toISOString(), { source })
	return [
		landing,
		hit(new Date(at.getTime() + (601 + minute) * MINUTE).toISOString(), {
			v: landing.v,
			type: 'goal',
			name: goal,
			landing: false,
			source,
			conversions: 1,
			revenue: 10,
			goals: [{ slug: goal, value: 10 }],
		}),
	]
}

/** A pageview of `path` and its engagement, which saw `item`. */
const seen = (ts: string, path: string, item: string): HitRow[] => {
	const view = hit(ts, { path })
	return [
		view,
		{
			...hit(ts, { path, v: view.v, type: 'engagement', landing: false }),
			lastAt: new Date(new Date(ts).getTime() + MINUTE),
			durationMs: 5_000,
			impressions: [item],
			source: undefined,
			channel: undefined,
		},
	]
}

/** The store with every raw read it is asked for counted, by its time window. */
const counting = (store: EventStore, reads: RawRead[]): EventStore => ({
	...store,
	readRaw: (read) => {
		reads.push(read)
		return store.readRaw(read)
	},
})

const rig = async (
	options: Omit<EngineOptions, 'caps'> & { caps?: CapsOption },
	hits: readonly HitRow[],
	clock = { at: NOON }
) => {
	const now = () => new Date(clock.at.getTime())
	const state = memoryStateStore({ now })
	const base = memoryEventStore({ state, now })
	await base.append(hits)
	const reads: RawRead[] = []
	const store = counting(base, reads)
	const { caps, ...rest } = options
	const engine = createEngine({
		payload: { logger: { warn: () => undefined } } as unknown as Payload,
		store,
		state,
		options: { now, warn: () => undefined, ...rest, ...(caps ? { caps: resolveCaps(caps) } : {}) },
	})
	return { store: base, state, engine, reads, clock }
}

const days = (from: CalendarDay, to: CalendarDay): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, 'UTC'),
	end: new Date(localDay(to, 'UTC').end.getTime() - 1),
})

const FOLDING = [
	...pages('2026-10-04', [
		['/c', 5],
		['/e', 4],
		['/f', 1],
	]),
	...pages('2026-10-05', [
		['/a', 10],
		['/b', 9],
		['/c', 8],
		['/d', 7],
	]),
]

describe('(other) rows in a breakdown', () => {
	it('never take a slot of the top values, which rank as the raw hits do', async () => {
		const ready = await rig({ caps: { page: 2 } }, FOLDING)
		const query: AnalyticsQuery = {
			metrics: ['pageviews'],
			dimensions: ['page'],
			limit: 2,
			dateRange: days(20261005, 20261005),
		}
		const answer = await ready.engine.read(query)
		expect(answer.rows).toEqual((await rawAnswer(ready.store, query, { tz: 'UTC' })).rows)
		expect(answer.rows.map((row) => row.dimensions?.page)).toEqual(['/a', '/b'])
		expect(answer.totals).toEqual({ pageviews: 34 })
	})
})

describe('a value folded into (other)', () => {
	it('is read from its raw hits on the days it was folded, while they are kept', async () => {
		const ready = await rig({ caps: { page: 2 } }, FOLDING)
		for (const [from, to] of [
			[20261005, 20261005],
			[20261004, 20261005],
		] as const) {
			const query: AnalyticsQuery = {
				metrics: ['pageviews', 'visitors'],
				path: '/c',
				dateRange: days(from, to),
			}
			const answer = await ready.engine.read(query)
			expect(answer.totals).toEqual((await rawAnswer(ready.store, query, { tz: 'UTC' })).totals)
			expect(answer.meta.capped).toBeUndefined()
		}
		const markers = await ready.state.markers('', 20261004, 20261005)
		expect(markers.map((marker) => marker.status)).toEqual(['final', 'final'])
	})

	it('reads its daily totals alone on days it kept its own row, others folding beside it', async () => {
		const ready = await rig({ caps: { page: 2 } }, FOLDING)
		await ready.engine.read({ metrics: ['pageviews'], dateRange: days(20261004, 20261005) })
		ready.reads.length = 0
		const kept = async (path: string, day: CalendarDay) =>
			(await ready.engine.read({ metrics: ['pageviews'], path, dateRange: days(day, day) })).totals
		expect(await kept('/a', 20261005)).toEqual({ pageviews: 10 })
		expect(await kept('/c', 20261004)).toEqual({ pageviews: 5 })
		expect(ready.reads).toEqual([])
		// No row of /a on the 4th, beside an (other) row: it may be among the folded, so read raw.
		expect(await kept('/a', 20261004)).toEqual({ pageviews: 0 })
		expect(ready.reads).toHaveLength(1)
	})

	it('reads as a floor on folded days whose raw hits are pruned, and says how many', async () => {
		const ready = await rig(
			{ caps: { page: 2 }, rawDays: 2, maintenance: { runner: true } },
			FOLDING
		)
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedHits).toBe(FOLDING.length)
		const answer = await ready.engine.read({
			metrics: ['pageviews'],
			path: '/c',
			dateRange: days(20261004, 20261005),
		})
		expect(answer.totals).toEqual({ pageviews: 5 })
		expect(answer.meta.capped).toEqual({ days: 1 })
	})

	it('reads a goal by source raw on the days its sources folded, each goal capped on its own', async () => {
		const hits = [
			...sale('2026-10-05', { minute: 0, source: 'google', goal: 'purchase' }),
			...sale('2026-10-05', { minute: 2, source: 'google', goal: 'purchase' }),
			...sale('2026-10-05', { minute: 4, source: 'bing', goal: 'purchase' }),
			...sale('2026-10-05', { minute: 6, source: 'news', goal: 'lead' }),
			...sale('2026-10-05', { minute: 8, source: 'bing', goal: 'lead' }),
		]
		const ready = await rig({ caps: { goalPairs: 1 } }, hits)
		for (const goal of ['purchase', 'lead']) {
			const query: AnalyticsQuery = {
				metrics: ['conversions', 'revenue'],
				dimensions: ['source'],
				filters: [{ dimension: 'goal', operator: 'eq', value: goal }],
				dateRange: days(20261005, 20261005),
			}
			const answer = await ready.engine.read(query)
			const raw = await rawAnswer(ready.store, query, { tz: 'UTC' })
			expect({ goal, rows: answer.rows, totals: answer.totals }).toEqual({
				goal,
				rows: raw.rows,
				totals: raw.totals,
			})
		}
		const [purchase] = await ready.store.readAggregates({
			scope: '',
			days: [[20261005, 20261005]],
			dim: 'goal',
			value: 'purchase',
			dim2: 'source',
			groupBy: 'total',
		})
		expect(purchase?.parts.conversions).toBe(3)
	})

	it('reads an item’s pages raw on the days they folded, the (other) row keeping the item', async () => {
		const hits = [
			...seen('2026-10-05T10:00:00.000Z', '/a', 'offers:1'),
			...seen('2026-10-05T10:05:00.000Z', '/a', 'offers:1'),
			...seen('2026-10-05T10:10:00.000Z', '/b', 'offers:1'),
			...seen('2026-10-05T10:15:00.000Z', '/b', 'offers:2'),
		]
		const ready = await rig({ caps: { itemPages: 1 } }, hits)
		const query: AnalyticsQuery = {
			metrics: ['impressions'],
			dimensions: ['page'],
			item: 'offers:1',
			dateRange: days(20261005, 20261005),
		}
		const answer = await ready.engine.read(query)
		expect(answer.rows).toEqual((await rawAnswer(ready.store, query, { tz: 'UTC' })).rows)
		expect(answer.rows.map((row) => [row.dimensions?.page, row.metrics.impressions])).toEqual([
			['/a', 2],
			['/b', 1],
		])
	})
})
