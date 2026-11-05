import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { localDay } from '../../src/native/engine/days'
import { createEngine, type EngineOptions, type NativeEngine } from '../../src/native/engine/engine'
import { rawAnswer } from '../../src/native/engine/rawAnswer'
import { native } from '../../src/native/nativeAdapter'
import { type CapsOption, resolveCaps } from '../../src/native/store/caps'
import { createEventStore } from '../../src/native/store/eventStore'
import { ulid } from '../../src/native/store/ids'
import { memoryStateStore } from '../../src/native/store/memory/memoryState'
import { memoryEventStore } from '../../src/native/store/memory/memoryStore'
import { createStateStore } from '../../src/native/store/stateStore'
import type { EventStore, FoldRead, HitRow, StateStore } from '../../src/native/store/types'
import { type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'

const NOON = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000

let serial = 0

const hit = (scope: string, ts: Date, more: Partial<HitRow> = {}): HitRow => {
	serial += 1
	return {
		id: ulid(ts),
		scope,
		ts,
		type: 'pageview',
		hostname: 'a.example',
		path: '/',
		v: `fold-${serial}`.padEnd(16, '0'),
		landing: true,
		server: false,
		source: 'direct',
		channel: 'direct',
		...more,
	}
}

const at = (day: CalendarDay, minutes: number): Date =>
	new Date(calendarDayStart(day, 'UTC').getTime() + minutes * MINUTE)

/** `count` landings on each path, one visitor each. */
const pages = (scope: string, day: CalendarDay, counts: ReadonlyArray<readonly [string, number]>) =>
	counts.flatMap(([path, count], p) =>
		Array.from({ length: count }, (_, i) => hit(scope, at(day, 600 + p * 60 + i), { path }))
	)

/** A visit landing from `source` that completes `goal` a minute later. */
const sale = (
	scope: string,
	{ day, minute, source, goal }: { day: CalendarDay; minute: number; source: string; goal: string }
) => {
	const landing = hit(scope, at(day, 600 + minute), { source })
	return [
		landing,
		hit(scope, at(day, 601 + minute), {
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

const days = (from: CalendarDay, to: CalendarDay): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, 'UTC'),
	end: new Date(localDay(to, 'UTC').end.getTime() - 1),
})

const FOLDING = (scope: string) => [
	...pages(scope, 20261004, [
		['/c', 5],
		['/e', 4],
		['/f', 1],
	]),
	...pages(scope, 20261005, [
		['/a', 10],
		['/b', 9],
		['/c', 8],
		['/d', 7],
	]),
]

describeForDb('native caps and folded values', {}, (db) => {
	let booted: BootedPayload
	let store: EventStore
	let state: StateStore
	const now = (): Date => NOON

	const engine = (
		options: Omit<EngineOptions, 'caps'> & { caps?: CapsOption } = {}
	): NativeEngine => {
		const { caps, ...rest } = options
		return createEngine({
			payload: booted.payload,
			store,
			state,
			options: {
				now,
				scoped: true,
				warn: () => undefined,
				...rest,
				...(caps ? { caps: resolveCaps(caps) } : {}),
			},
		})
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
		})
		store = createEventStore(booted.payload, { now })
		state = createStateStore(booted.payload, { now })
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`ranks a capped breakdown without its (other) row, as the raw hits rank it, on ${db}`, async () => {
		await store.append(FOLDING('top'))
		const query: AnalyticsQuery = {
			scope: 'top',
			metrics: ['pageviews'],
			dimensions: ['page'],
			limit: 2,
			dateRange: days(20261005, 20261005),
		}
		const answer = await engine({ caps: { page: 2 } }).read(query)
		expect(answer.rows).toEqual((await rawAnswer(store, query, { scope: 'top', tz: 'UTC' })).rows)
		expect(answer.rows.map((row) => row.dimensions?.page)).toEqual(['/a', '/b'])
	})

	it(`reads a value folded into (other) from its raw hits on the days it folded on ${db}`, async () => {
		await store.append(FOLDING('eq'))
		const reading = engine({ caps: { page: 2 } })
		for (const range of [days(20261005, 20261005), days(20261004, 20261005)]) {
			const query: AnalyticsQuery = {
				scope: 'eq',
				metrics: ['pageviews', 'visitors'],
				path: '/c',
				dateRange: range,
			}
			const answer = await reading.read(query)
			expect(answer.totals).toEqual(
				(await rawAnswer(store, query, { scope: 'eq', tz: 'UTC' })).totals
			)
			expect(answer.meta.capped).toBeUndefined()
		}
	})

	it(`finds the same folded days and hostnames as the memory reference on ${db}`, async () => {
		const hits = [
			...FOLDING('found'),
			...pages('found', 20261005, [['/c', 1]]).map((each) => ({ ...each, hostname: 'b.example' })),
		]
		await store.append(hits)
		const memoryState = memoryStateStore({ now })
		const memory = memoryEventStore({ state: memoryState, now })
		await memory.append(hits)
		const caps: CapsOption = { page: 2 }
		await engine({ caps }).read({
			scope: 'found',
			metrics: ['pageviews'],
			dateRange: days(20261004, 20261005),
		})
		await createEngine({
			payload: booted.payload,
			store: memory,
			state: memoryState,
			options: { now, scoped: true, warn: () => undefined, caps: resolveCaps(caps) },
		}).read({ scope: 'found', metrics: ['pageviews'], dateRange: days(20261004, 20261005) })
		const folded: FoldRead = {
			scope: 'found',
			days: [[20261004, 20261005]],
			dim: 'page',
			value: '/c',
		}
		const reads: FoldRead[] = [
			folded,
			{ scope: 'found', days: [[20261004, 20261005]], dim: 'page', value: '/a' },
			{ scope: 'found', days: [[20261004, 20261005]], dim: 'page', value: '/f' },
			{
				scope: 'found',
				days: [[20261004, 20261005]],
				hostname: 'b.example',
				dim: 'page',
				value: '/c',
			},
		]
		for (const read of reads) {
			expect({ read, days: await store.foldedDays(read) }).toEqual({
				read,
				days: await memory.foldedDays(read),
			})
		}
		expect(await store.foldedDays(folded)).toEqual([20261005])
		expect(await store.hostnames('found', 20261001)).toEqual(['a.example', 'b.example'])
		expect(await store.hostnames('found', 20261006)).toEqual([])
	})

	it(`caps a goal’s sources on their own and reads the folded ones raw on ${db}`, async () => {
		await store.append([
			...sale('goals', { day: 20261005, minute: 0, source: 'google', goal: 'purchase' }),
			...sale('goals', { day: 20261005, minute: 2, source: 'google', goal: 'purchase' }),
			...sale('goals', { day: 20261005, minute: 4, source: 'bing', goal: 'purchase' }),
			...sale('goals', { day: 20261005, minute: 6, source: 'news', goal: 'lead' }),
			...sale('goals', { day: 20261005, minute: 8, source: 'bing', goal: 'lead' }),
		])
		const reading = engine({ caps: { goalPairs: 1 } })
		for (const goal of ['purchase', 'lead']) {
			const query: AnalyticsQuery = {
				scope: 'goals',
				metrics: ['conversions', 'revenue'],
				dimensions: ['source'],
				filters: [{ dimension: 'goal', operator: 'eq', value: goal }],
				dateRange: days(20261005, 20261005),
			}
			const answer = await reading.read(query)
			const raw = await rawAnswer(store, query, { scope: 'goals', tz: 'UTC' })
			expect({ goal, rows: answer.rows, totals: answer.totals }).toEqual({
				goal,
				rows: raw.rows,
				totals: raw.totals,
			})
		}
		expect(
			await store.foldedDays({
				scope: 'goals',
				days: [[20261005, 20261005]],
				dim: 'goal',
				dim2: 'source',
				value: 'purchase',
			})
		).toEqual([20261005])
	})

	// Last: its maintenance prunes the raw hits of every scope before the floor.
	it(`reads a folded value as a floor once its raw hits are pruned, and says so on ${db}`, async () => {
		await store.append(FOLDING('floor'))
		const pruning = engine({ caps: { page: 2 }, rawDays: 2, maintenance: { runner: true } })
		await pruning.maintain({ budgetMs: 120_000 })
		expect(await store.oldestHit('floor')).toBeNull()
		const answer = await pruning.read({
			scope: 'floor',
			metrics: ['pageviews'],
			path: '/c',
			dateRange: days(20261004, 20261005),
		})
		expect(answer.totals).toEqual({ pageviews: 5 })
		expect(answer.meta.capped).toEqual({ days: 1 })
	})
})
