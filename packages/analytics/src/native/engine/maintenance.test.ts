import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { isRecord } from '../../core/values'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { dedupeKeyFor } from '../ingest/revenue'
import { AGGREGATION_VERSION } from '../store/aggregate'
import { orderHitId } from '../store/ids'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import { DAY_LEASE_MS, dayKey, leaseKey } from '../store/state'
import type { DayMarker, EventStore, HitRow, StateStore } from '../store/types'
import { MAINTAIN_TASK_SLUG } from '../tasks/maintainTask'
import { createEngine, type EngineOptions, type NativeEngine } from './engine'
import {
	aggregatePruneDay,
	dueDays,
	MAX_COUNT_ATTEMPTS,
	PRUNE_CHUNK,
	rawPruneCut,
} from './maintenance'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const TODAY = 20261007
/** Noon UTC: 20261006 closed at a quarter past midnight and is provisional until tomorrow. */
const NOON = new Date('2026-10-07T12:00:00.000Z')

let serial = 0

/** A landing pageview `minutes` into a UTC day, by a visitor of its own. */
const hitOn = (scope: string, day: CalendarDay, minutes = 60): HitRow => {
	serial += 1
	return {
		id: `M${String(serial).padStart(9, '0')}`,
		scope,
		ts: new Date(calendarDayStart(day, 'UTC').getTime() + minutes * MINUTE),
		type: 'pageview',
		hostname: 'a.example',
		path: '/',
		v: `v${serial}`.padEnd(16, 'x'),
		landing: true,
		server: false,
	}
}

/** What a recorded call is called in a test's log: the steps of a run, by what they touch. */
const labelOf = (name: string, key: string, args: readonly unknown[]): string => {
	const [first, second] = args
	if (key === 'aggregateDay' && isRecord(first) && isRecord(second)) {
		return `aggregate ${String(first.scope)}:${String(first.day)} ${String(second.status)}`
	}
	if (key === 'oldestHit') {
		return `discover ${String(first)}`
	}
	if (key === 'pruneHits' && isRecord(first)) {
		return `prune ${String(first.scope)}`
	}
	if (key === 'claim' || key === 'release') {
		return `${key} ${String(first)}`
	}
	return `${name}.${key}`
}

/** `target` with every method call written to `log` first. */
const recording = <T extends object>(target: T, name: string, log: string[]): T =>
	new Proxy(target, {
		get(object, key) {
			const value: unknown = Reflect.get(object, key)
			if (typeof value !== 'function') {
				return value
			}
			return (...args: unknown[]) => {
				log.push(labelOf(name, String(key), args))
				return Reflect.apply(value, object, args)
			}
		},
	})

interface Rig {
	store: EventStore
	state: StateStore
	engine: NativeEngine
	log: string[]
	/** Payload's clock, and the wall clock budgets are spent in. */
	at: { now: number; wall: number }
}

const quietLogger = { logger: { warn: () => undefined } }

const rig = async (
	options: EngineOptions,
	hits: readonly HitRow[],
	wrap: (store: EventStore, at: Rig['at']) => EventStore = (store) => store
): Promise<Rig> => {
	const at = { now: NOON.getTime(), wall: 0 }
	const now = () => new Date(at.now)
	const log: string[] = []
	const state = recording(memoryStateStore({ now }), 'state', log)
	const store = wrap(recording(memoryEventStore({ state, now }), 'store', log), at)
	const engine = createEngine({
		// The engine only reaches for Payload's logger, which a test silences.
		payload: quietLogger as unknown as Payload,
		store,
		state,
		options: { now, clock: () => at.wall, warn: () => undefined, ...options },
	})
	await store.append(hits)
	log.length = 0
	return { store, state, engine, log, at }
}

const statusesOf = async (
	state: StateStore,
	scope: string,
	[from, to]: readonly [CalendarDay, CalendarDay]
) => (await state.markers(scope, from, to)).map((marker) => [marker.day, marker.status])

const STEPS =
	/^(claim lease|release lease|state\.sweep|discover|state\.pending|aggregate|prune|state\.beat)/

describe('a maintenance run', () => {
	const scoped = { scoped: true, rawDays: 5, today: { snapshotAboveHits: 0 } }
	const history = [
		hitOn('a', 20261001),
		hitOn('a', 20261005),
		hitOn('a', 20261006, 60),
		hitOn('a', 20261006, 120),
		hitOn('a', TODAY, 30),
		hitOn('b', 20261004),
	]

	it('runs its steps in order: salts, the days the state rows hold due, each scope in turn, the heartbeat', async () => {
		const ready = await rig(scoped, history)
		await ready.state.salt(20261001)
		const report = await ready.engine.maintain({ budgetMs: 60_000, heartbeat: true })
		expect(ready.log.filter((entry) => STEPS.test(entry))).toEqual([
			'claim lease:maintain',
			'state.sweep',
			'state.pending',
			'discover a',
			'aggregate a:20261001 final',
			'aggregate a:20261005 final',
			'aggregate a:20261006 provisional',
			'aggregate a:20261007 partial',
			'prune a',
			'discover b',
			'aggregate b:20261004 final',
			'prune b',
			'release lease:maintain',
			'state.beat',
		])
		expect(report).toEqual({
			ran: true,
			finished: true,
			sweptSalts: 1,
			sweptRows: 0,
			discovered: 4,
			empty: 4,
			aggregated: 4,
			failed: 0,
			markedFailed: 0,
			deferred: 0,
			snapshots: 1,
			sweptOrders: 0,
			prunedHits: 1,
			expiredOrders: 0,
			prunedAggregates: 0,
			prunedMarkers: 0,
			scopesPassed: 2,
			scopesSkipped: 0,
		})
		expect(await statusesOf(ready.state, 'a', [20261001, TODAY])).toEqual([
			[20261001, 'final'],
			[20261003, 'empty'],
			[20261004, 'empty'],
			[20261005, 'final'],
			[20261006, 'provisional'],
			[TODAY, 'partial'],
		])
		expect(await statusesOf(ready.state, 'b', [20261001, TODAY])).toEqual([
			[20261003, 'empty'],
			[20261004, 'final'],
			[20261005, 'empty'],
		])
		expect(await ready.state.lastBeat(MAINTAIN_TASK_SLUG)).toEqual(NOON)
	})

	it('holds a scope’s own counts to its share, stops once the budget is spent, and the next run counts the days left due first, then goes on with the next scope', async () => {
		const ready = await rig(scoped, history, (store, at) => ({
			...store,
			aggregateDay: (window, run) => {
				at.wall += 1_000
				return store.aggregateDay(window, run)
			},
		}))
		const first = await ready.engine.maintain({ budgetMs: 1_500 })
		expect(first).toMatchObject({
			ran: true,
			finished: false,
			aggregated: 1,
			snapshots: 1,
			prunedHits: 0,
		})
		expect(await statusesOf(ready.state, 'a', [20261005, 20261006])).toEqual([
			[20261005, 'open'],
			[20261006, 'open'],
		])
		expect(await ready.state.markers('b', 20261001, TODAY)).toEqual([])
		ready.log.length = 0
		const second = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(second).toMatchObject({ ran: true, finished: true, aggregated: 3, prunedHits: 1 })
		expect(ready.log.filter((entry) => STEPS.test(entry))).toEqual([
			'claim lease:maintain',
			'state.sweep',
			'state.pending',
			'aggregate a:20261005 final',
			'aggregate a:20261006 provisional',
			'discover b',
			'aggregate b:20261004 final',
			'prune b',
			'discover a',
			'prune a',
			'release lease:maintain',
		])
	})

	it('leaves the work to the run holding the lease, and still records a runner’s heartbeat', async () => {
		const ready = await rig(scoped, history)
		expect(await ready.state.claim(leaseKey('maintain'), 'elsewhere', DAY_LEASE_MS)).toBe(true)
		const report = await ready.engine.maintain({ budgetMs: 60_000, heartbeat: true })
		expect(report).toMatchObject({ ran: false, aggregated: 0 })
		expect(await ready.state.markers('a', 20261001, TODAY)).toEqual([])
		expect(await ready.state.lastBeat(MAINTAIN_TASK_SLUG)).toEqual(NOON)
	})

	it('does the work once when two runs start together', async () => {
		const ready = await rig(scoped, history)
		const [one, two] = await Promise.all([
			ready.engine.maintain({ budgetMs: 60_000 }),
			ready.engine.maintain({ budgetMs: 60_000 }),
		])
		expect([one?.ran, two?.ran].sort()).toEqual([false, true])
		expect((one?.aggregated ?? 0) + (two?.aggregated ?? 0)).toBe(4)
	})

	it('renews its lease while a step outlasts it, so no second run starts beside it', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
		try {
			let release: () => void = () => {}
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			let counting = false
			const ready = await rig(scoped, history, (store) => ({
				...store,
				aggregateDay: async (window, run) => {
					counting = true
					await gate
					return store.aggregateDay(window, run)
				},
			}))
			const ttl = 60_000 + DAY_LEASE_MS
			const first = ready.engine.maintain({ budgetMs: 60_000 })
			await vi.waitFor(() => expect(counting).toBe(true))
			ready.at.now += ttl - 1_000
			await vi.advanceTimersByTimeAsync(Math.floor(ttl / 3))
			ready.at.now += 2_000
			expect((await ready.engine.maintain({ budgetMs: 60_000 })).ran).toBe(false)
			release()
			expect((await first).ran).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	it('stops at its next day once the engine is closed, and the close waits for it', async () => {
		let closing: Promise<void> | undefined
		let engine: NativeEngine | undefined
		const ready = await rig(scoped, history, (store) => ({
			...store,
			aggregateDay: async (window, run) => {
				const result = await store.aggregateDay(window, run)
				closing ??= engine?.close()
				return result
			},
		}))
		engine = ready.engine
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report).toMatchObject({ ran: true, finished: false, aggregated: 1 })
		await closing
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({ ran: false })
	})

	it('skips a scope whose zone never resolved, rather than counting it in UTC', async () => {
		const ready = await rig(
			{
				...scoped,
				timezone: (scope) => {
					if (scope === 'b') {
						throw new Error('tenant lookup down')
					}
					return 'UTC'
				},
			},
			history
		)
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.failed).toBe(0)
		expect(await ready.state.markers('b', 20261001, TODAY)).toEqual([])
		expect(await statusesOf(ready.state, 'a', [20261005, 20261005])).toEqual([[20261005, 'final']])
	})

	it('counts a day cut in another zone again in the new one, within the raw retention', async () => {
		let zone = 'UTC'
		const ready = await rig({ rawDays: 30, timezone: () => zone }, [
			hitOn('', 20261002, 10 * 60),
			hitOn('', 20261005, 10 * 60),
		])
		await ready.engine.maintain({ budgetMs: 60_000 })
		zone = 'America/New_York'
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		const markers = await ready.state.markers('', 20261001, TODAY)
		const counted = markers.filter((marker) => marker.gen !== null || marker.status === 'empty')
		expect(counted.every((marker) => marker.tz === 'America/New_York')).toBe(true)
		expect(report.aggregated).toBeGreaterThanOrEqual(2)
	})

	it('sweeps the rows a run left when it stopped between completing a day and clearing the old ones, however long ago', async () => {
		let failCompletion = false
		const at = { now: NOON.getTime() }
		const now = () => new Date(at.now)
		const base = memoryStateStore({ now })
		const state: StateStore = {
			...base,
			async complete(marker, owner) {
				const done = await base.complete(marker, owner)
				if (failCompletion) {
					throw new Error('connection lost after the update landed')
				}
				return done
			},
		}
		const store = memoryEventStore({ state, now })
		const engine = createEngine({
			payload: quietLogger as unknown as Payload,
			store,
			state,
			options: { now, warn: () => undefined },
		})
		await store.append([hitOn('', 20261005), hitOn('', 20261005, 90)])
		await engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
		const [first] = await state.markers('', 20261005, 20261005)
		failCompletion = true
		await expect(engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })).rejects.toThrow(
			/connection lost/
		)
		failCompletion = false
		const [second] = await state.markers('', 20261005, 20261005)
		expect(second?.gen).not.toBe(first?.gen)
		const read = () =>
			store.readAggregates({ scope: '', days: [[20261005, 20261005]], dim: '', groupBy: 'total' })
		expect((await read())[0]?.parts.pageviews).toBe(2)
		expect(await state.drops(10)).toEqual([{ scope: '', day: 20261005, gen: second?.gen }])
		// A day and more without maintenance: the note is still there to finish.
		at.now += 30 * HOUR
		const report = await engine.maintain({ budgetMs: 60_000 })
		expect(report.sweptRows).toBeGreaterThan(0)
		expect((await read())[0]?.parts.pageviews).toBe(2)
		expect(await state.drops(10)).toEqual([])
		expect((await engine.maintain({ budgetMs: 60_000 })).sweptRows).toBe(0)
	})

	it('returns a fixed day marked dirty to its count, so it stops taking a pending slot', async () => {
		const ready = await rig({ rawDays: 30 }, [hitOn('', 20261002), hitOn('', 20261002, 90)])
		await ready.engine.maintain({ budgetMs: 60_000 })
		const [counted] = await ready.state.markers('', 20261002, 20261002)
		expect(counted?.status).toBe('final')
		// Part of the day's raw hits are gone, so its count is fixed for good.
		await ready.state.recordPruned('', new Date(calendarDayStart(20261002, 'UTC').getTime() + HOUR))
		await ready.state.markDirty('', [20261002])
		const pendingAt = new Date(ready.at.now)
		expect((await ready.state.pending(pendingAt, 10)).map((marker) => marker.day)).toEqual([
			20261002,
		])
		ready.log.length = 0
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.failed).toBe(0)
		expect(ready.log.some((entry) => entry.startsWith('aggregate :20261002'))).toBe(false)
		const [settled] = await ready.state.markers('', 20261002, 20261002)
		expect(settled).toMatchObject({ status: 'final', gen: counted?.gen, leaseOwner: null })
		expect(await ready.state.pending(pendingAt, 10)).toEqual([])
		const read = await ready.engine.read({
			metrics: ['pageviews'],
			dateRange: {
				start: calendarDayStart(20261002, 'UTC'),
				end: new Date(calendarDayStart(20261003, 'UTC').getTime() - 1),
			},
		})
		expect(read.totals).toEqual({ pageviews: 2 })
	})

	it('finishes a drop note whose day has no marker left by deleting every row of that day', async () => {
		const ready = await rig({}, [])
		await ready.state.noteDrop({ scope: '', day: 20260901, gen: 'G-orphan' })
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.sweptRows).toBe(0)
		expect(await ready.state.drops(10)).toEqual([])
	})
})

describe('scopes in turn', () => {
	const scoped = { scoped: true, rawDays: 5, today: { snapshotAboveHits: 0 } }

	it('passes over a scope with nothing new since its last full pass, until a hit lands or a day closes', async () => {
		const ready = await rig(scoped, [hitOn('a', 20261005), hitOn('b', 20261004)])
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			scopesPassed: 2,
			scopesSkipped: 0,
		})
		ready.log.length = 0
		const idle = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(idle).toMatchObject({ scopesPassed: 0, scopesSkipped: 2, aggregated: 0 })
		expect(ready.log.filter((entry) => entry.startsWith('discover'))).toEqual([])
		await ready.store.append([{ ...hitOn('b', TODAY), ts: new Date(ready.at.now - MINUTE) }])
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			scopesPassed: 1,
			scopesSkipped: 1,
		})
		ready.at.now += 24 * HOUR
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			scopesPassed: 2,
			scopesSkipped: 0,
		})
	})

	it('gives every scope its turn, pruning included, when one run only has budget for one', async () => {
		const scopes = ['a', 'b', 'c']
		const ready = await rig(
			{ scoped: true, rawDays: 5 },
			scopes.flatMap((scope) => [hitOn(scope, 20260920), hitOn(scope, 20261005)]),
			(store, at) => ({
				...store,
				oldestHit: (scope) => {
					at.wall += 1_000
					return store.oldestHit(scope)
				},
			})
		)
		const reports = []
		for (let run = 0; run < scopes.length; run++) {
			reports.push(await ready.engine.maintain({ budgetMs: 1_500 }))
		}
		expect(reports.map((report) => report.scopesPassed)).toEqual([2, 2, 1])
		for (const scope of scopes) {
			expect(await ready.store.oldestHit(scope)).toEqual(
				new Date(calendarDayStart(20261005, 'UTC').getTime() + HOUR)
			)
			expect(await statusesOf(ready.state, scope, [20261005, 20261005])).toEqual([
				[20261005, 'final'],
			])
		}
	})

	it('gives up on a day whose count keeps failing, prunes past it, and reads say so', async () => {
		const ready = await rig(
			{ rawDays: 5 },
			[hitOn('', 20261005), hitOn('', 20261006)],
			(store) => ({
				...store,
				aggregateDay: async (window, run) => {
					if (window.day === 20261005) {
						throw new Error('the database ran out of memory')
					}
					return store.aggregateDay(window, run)
				},
			})
		)
		for (let attempt = 1; attempt <= MAX_COUNT_ATTEMPTS; attempt++) {
			expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
				failed: 1,
				markedFailed: 0,
			})
		}
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			failed: 0,
			markedFailed: 1,
		})
		expect(await statusesOf(ready.state, '', [20261005, 20261005])).toEqual([[20261005, 'failed']])
		expect(await ready.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			failed: 0,
			markedFailed: 0,
		})
		const day = {
			start: calendarDayStart(20261005, 'UTC'),
			end: new Date(calendarDayStart(20261007, 'UTC').getTime() - 1),
		}
		const read = await ready.engine.read({
			metrics: ['pageviews'],
			timezone: 'UTC',
			dateRange: day,
		})
		expect(read.totals).toEqual({ pageviews: 1 })
		expect(read.meta.failed).toEqual({ days: 1 })
		ready.at.now += 5 * 24 * HOUR
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(await ready.store.oldestHit('')).toBeNull()
	})

	it('sweeps every order stored in one millisecond, however many share it', async () => {
		const at = new Date(NOON.getTime() - MINUTE)
		const orders = Array.from({ length: 1_001 }, (_, index) => ({
			...hitOn('', TODAY),
			id: orderHitId(dedupeKeyFor({ origin: 'server', goal: 'purchase', orderId: `o${index}` })),
			ts: at,
			v: '',
			server: true,
		}))
		const ready = await rig({}, orders)
		expect((await ready.engine.maintain({ budgetMs: 60_000 })).sweptOrders).toBe(orders.length)
	})

	it('renews a day’s lease while its count outlasts it, so no other run counts it beside', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
		try {
			let release: () => void = () => {}
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			let counting = false
			const ready = await rig({}, [hitOn('', 20261005)], (store) => ({
				...store,
				aggregateDay: async (window, run) => {
					counting = true
					await gate
					return store.aggregateDay(window, run)
				},
			}))
			const first = ready.engine.aggregate({ scope: '', day: 20261005, tz: 'UTC' })
			await vi.waitFor(() => expect(counting).toBe(true))
			ready.at.now += DAY_LEASE_MS - MINUTE
			await vi.advanceTimersByTimeAsync(Math.floor(DAY_LEASE_MS / 3))
			ready.at.now += 2 * MINUTE
			expect(await ready.state.claim(dayKey('', 20261005), 'elsewhere', DAY_LEASE_MS)).toBe(false)
			release()
			expect(await first).toMatchObject({ outcome: 'completed' })
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('pruning in a maintenance run', () => {
	it('deletes raw hits before the floor in chunks, never one of a day not yet final', async () => {
		const old = Array.from({ length: PRUNE_CHUNK + 1_200 }, (_, index) =>
			hitOn('', 20260920, 60 + (index % 600))
		)
		const ready = await rig({ rawDays: 3 }, [...old, hitOn('', 20260925), hitOn('', 20261006)])
		// Another run holds 20260925, so it stays open, and so do its raw hits.
		await ready.state.ensureMarkers([{ scope: '', day: 20260925, tz: 'UTC' }])
		expect(await ready.state.claim(dayKey('', 20260925), 'elsewhere', DAY_LEASE_MS)).toBe(true)
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedHits).toBe(old.length)
		expect(ready.log.filter((entry) => entry === 'prune ')).toHaveLength(2)
		expect(await ready.store.oldestHit('')).toEqual(
			new Date(calendarDayStart(20260925, 'UTC').getTime() + HOUR)
		)

		ready.at.now += DAY_LEASE_MS + MINUTE
		const after = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(after.prunedHits).toBe(1)
		expect(await ready.store.oldestHit('')).toEqual(
			new Date(calendarDayStart(20261006, 'UTC').getTime() + HOUR)
		)
	})

	it('deletes daily totals and their markers past aggregateDays, and keeps them by default', async () => {
		const hits = [hitOn('', 20260920), hitOn('', 20261001), hitOn('', 20261005)]
		const kept = await rig({ rawDays: 3 }, hits)
		expect(await kept.engine.maintain({ budgetMs: 60_000 })).toMatchObject({
			prunedAggregates: 0,
			prunedMarkers: 0,
		})
		expect(await statusesOf(kept.state, '', [20260920, 20260920])).toEqual([[20260920, 'final']])

		const pruned = await rig({ rawDays: 3, aggregateDays: 10 }, hits)
		const report = await pruned.engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedAggregates).toBeGreaterThan(0)
		expect(await pruned.state.markers('', 20260901, 20260927)).toEqual([])
		expect(await statusesOf(pruned.state, '', [20261001, 20261001])).toEqual([[20261001, 'final']])
		const left = await pruned.store.readAggregates({
			scope: '',
			days: [[20260901, TODAY]],
			dim: '',
			groupBy: 'total',
		})
		expect(left[0]?.parts.pageviews).toBe(2)
	})
})

describe('orders in a maintenance run', () => {
	const DAY = 24 * HOUR
	/** The browser's record of a sale, made in a visit from Germany that a campaign brought. */
	const sale = (id: string, at: string, amount: number): HitRow => ({
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
		country: 'DE',
		utmCampaign: 'fall',
		value: amount,
		conversions: 1,
		revenue: amount,
		goals: [{ slug: 'purchase', value: amount }],
	})
	/** The server's record of a sale, which came with no visitor. */
	const serverSale = (id: string, at: string, amount: number): HitRow => {
		const { country: _country, utmCampaign: _campaign, ...bare } = sale(id, at, amount)
		return { ...bare, path: '/orders', v: '', server: true }
	}
	const keysOf = (orderId: string) => {
		const parts = { goal: 'purchase', orderId }
		return {
			wire: orderHitId(dedupeKeyFor({ origin: 'wire', ...parts })),
			server: orderHitId(dedupeKeyFor({ origin: 'server', ...parts })),
		}
	}
	const totals = async (ready: Rig, first: CalendarDay, last: CalendarDay) =>
		(
			await ready.engine.read({
				metrics: ['conversions', 'revenue'],
				timezone: 'UTC',
				dateRange: {
					start: calendarDayStart(first, 'UTC'),
					end: new Date(calendarDayStart(addCalendarDays(last, 1), 'UTC').getTime() - 1),
				},
			})
		).totals

	it("keeps an order's records as tombstones past the raw floor, so a sale credited on the floor day counts once for good", async () => {
		const floor = keysOf('ord_floor')
		const gone = keysOf('ord_gone')
		const ready = await rig({ rawDays: 3 }, [
			hitOn('', 20261004),
			sale(gone.wire, '2026-10-04T10:00:00.000Z', 9),
			sale(floor.wire, '2026-10-05T20:00:00.000Z', 9),
		])
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(await ready.store.hitById(gone.wire)).toMatchObject({ v: '', revenue: 9 })
		expect(await ready.store.hitById(gone.wire)).not.toHaveProperty('country')
		expect(await ready.store.oldestHit('')).toEqual(new Date('2026-10-04T10:00:00.000Z'))

		await ready.store.append([serverSale(floor.server, '2026-10-06T10:00:00.000Z', 250)])
		await ready.engine.orderStored('', floor.server)
		expect(await statusesOf(ready.state, '', [20261005, 20261005])).toEqual([[20261005, 'dirty']])
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(await totals(ready, 20261005, 20261006)).toEqual({ conversions: 1, revenue: 250 })

		ready.at.now += DAY
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.prunedHits).toBeGreaterThan(0)
		expect(await ready.store.hitById(floor.wire)).toMatchObject({ v: '', revenue: 9 })
		expect(await totals(ready, 20261005, 20261007)).toEqual({ conversions: 1, revenue: 250 })
		expect(await ready.state.markers('', 20261003, 20261004)).toEqual([
			expect.objectContaining({ day: 20261004, status: 'final' }),
		])
	})

	it("deletes an order's tombstone with its day's totals", async () => {
		const old = keysOf('ord_old')
		const ready = await rig({ rawDays: 3, aggregateDays: 5 }, [
			sale(old.wire, '2026-10-01T10:00:00.000Z', 9),
			sale(keysOf('ord_new').wire, '2026-10-04T10:00:00.000Z', 9),
		])
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.expiredOrders).toBe(1)
		expect(await ready.store.hitById(old.wire)).toBeNull()
		expect(await ready.store.hitById(keysOf('ord_new').wire)).toMatchObject({ v: '' })
	})

	it("sweeps the orders stored since the last run, counting again a closed day ingest's own check missed", async () => {
		const late = keysOf('ord_late')
		const ready = await rig({}, [serverSale(late.server, '2026-10-07T23:50:00.000Z', 250)])
		ready.at.now = Date.parse('2026-10-08T00:20:00.000Z')
		expect((await ready.engine.maintain({ budgetMs: 60_000 })).sweptOrders).toBe(0)
		expect(await totals(ready, 20261007, 20261007)).toEqual({ conversions: 1, revenue: 250 })
		// The browser's record lands after midnight, and its own check of the server's day is lost.
		await ready.store.append([sale(late.wire, '2026-10-08T00:22:00.000Z', 9)])
		ready.at.now = Date.parse('2026-10-08T00:40:00.000Z')
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.sweptOrders).toBe(1)
		expect(await totals(ready, 20261007, 20261007)).toEqual({ conversions: 0, revenue: 0 })
		expect(await totals(ready, 20261008, 20261008)).toEqual({ conversions: 1, revenue: 250 })
		ready.at.now += HOUR
		const again = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(again.sweptOrders).toBe(0)
		expect(again.aggregated).toBe(0)
	})
})

const marker = (overrides: Partial<DayMarker>): DayMarker => ({
	scope: 's',
	day: 20261005,
	tz: 'UTC',
	start: null,
	status: 'final',
	version: AGGREGATION_VERSION,
	gen: 'G',
	hits: 3,
	leaseOwner: null,
	leaseUntil: null,
	finalAfter: null,
	aggregatedAt: NOON,
	...overrides,
})

/** Where Berlin's 20261002 starts: the raw hits before it may be gone. */
const BERLIN_SECOND = new Date('2026-10-01T22:00:00.000Z')

describe('dueDays', () => {
	const due = (markers: DayMarker[], tz = 'UTC', prunedBefore: Date | null = BERLIN_SECOND) =>
		dueDays({ markers, tz, now: NOON, lastClosed: 20261006, prunedBefore }).map(
			(day) => `${day.day} ${day.tz} ${day.via}`
		)

	it('counts closed days never counted whole, days marked dirty and provisional days now sealed', () => {
		expect(
			due([
				marker({ day: 20261002, status: 'open', gen: null }),
				marker({ day: 20261003, status: 'partial' }),
				marker({ day: 20261004, status: 'dirty' }),
				marker({ day: 20261005, status: 'provisional' }),
				marker({ day: 20261006, status: 'provisional' }),
				marker({ day: TODAY, status: 'partial' }),
			])
		).toEqual([
			'20261002 UTC aggregate',
			'20261003 UTC aggregate',
			'20261004 UTC aggregate',
			'20261005 UTC aggregate',
		])
	})

	it('counts again a day of another zone or aggregation version, only while its count is not fixed', () => {
		const stale = [
			marker({ day: 20261001, tz: 'Europe/Berlin' }),
			marker({ day: 20261002, tz: 'Europe/Berlin' }),
			marker({ day: 20261003, version: AGGREGATION_VERSION - 1 }),
			marker({ day: 20261004 }),
			marker({ day: 20261005, status: 'empty', gen: null, tz: 'Europe/Berlin' }),
			marker({ day: 20261006, status: 'empty', gen: null }),
		]
		expect(due(stale)).toEqual([
			'20261002 UTC aggregate',
			'20261003 UTC aggregate',
			'20261005 UTC probe',
		])
		expect(due(stale, 'UTC', null)).toEqual([
			'20261001 UTC aggregate',
			'20261002 UTC aggregate',
			'20261003 UTC aggregate',
			'20261005 UTC probe',
		])
	})

	it('counts the day after a fixed one from where that one ended, and never a fixed day itself', () => {
		const days = dueDays({
			markers: [
				marker({ day: 20261001, tz: 'Europe/Berlin' }),
				marker({ day: 20261002, tz: 'Europe/Berlin' }),
				marker({ day: 20261003, status: 'dirty' }),
			],
			tz: 'UTC',
			now: NOON,
			lastClosed: 20261006,
			prunedBefore: new Date('2026-10-02T12:00:00.000Z'),
		})
		expect(days.map((day) => [day.day, day.start?.toISOString(), day.via])).toEqual([
			[20261003, '2026-10-02T22:00:00.000Z', 'aggregate'],
		])
	})
})

describe('rawPruneCut', () => {
	it('cuts at the start of the oldest raw day kept, in the scope’s zone', () => {
		for (const [tz, start] of [
			['UTC', '2026-10-05T00:00:00.000Z'],
			['America/New_York', '2026-10-05T04:00:00.000Z'],
			['Asia/Kolkata', '2026-10-04T18:30:00.000Z'],
		] as const) {
			expect(
				rawPruneCut({ now: NOON, tz, rawDays: 3, markers: [], prunedBefore: null })?.toISOString(),
				tz
			).toBe(start)
		}
	})

	it('stops at the start of the oldest day not yet final, whichever zone starts it earlier', () => {
		const cut = rawPruneCut({
			now: NOON,
			tz: 'UTC',
			rawDays: 3,
			markers: [
				marker({ day: 20260920 }),
				marker({ day: 20260921, status: 'empty', gen: null }),
				marker({ day: 20260925, status: 'provisional', tz: 'Asia/Kolkata' }),
				marker({ day: 20260926, status: 'dirty' }),
			],
			prunedBefore: null,
		})
		expect(cut?.toISOString()).toBe('2026-09-24T18:30:00.000Z')
	})

	it('stops at a final day counted in another zone, which is counted again first', () => {
		const cut = rawPruneCut({
			now: NOON,
			tz: 'UTC',
			rawDays: 3,
			markers: [marker({ day: 20261001 }), marker({ day: 20261002, tz: 'Asia/Tokyo' })],
			prunedBefore: null,
		})
		expect(cut?.toISOString()).toBe('2026-10-01T15:00:00.000Z')
	})

	it('never stops at a fixed day: its raw hits are partly gone already', () => {
		const cut = rawPruneCut({
			now: NOON,
			tz: 'UTC',
			rawDays: 3,
			markers: [marker({ day: 20260930, status: 'dirty' })],
			prunedBefore: new Date('2026-10-01T00:00:00.000Z'),
		})
		expect(cut?.toISOString()).toBe('2026-10-05T00:00:00.000Z')
	})

	it('keeps every hit when retention keeps every hit', () => {
		expect(
			rawPruneCut({ now: NOON, tz: 'UTC', rawDays: null, markers: [], prunedBefore: null })
		).toBeNull()
	})
})

describe('aggregatePruneDay', () => {
	it('keeps the last aggregateDays dates, and every day not yet final but a fixed one', () => {
		const first = (markers: DayMarker[], prunedBefore: Date | null = null) =>
			aggregatePruneDay({ today: TODAY, aggregateDays: 10, markers, prunedBefore })
		expect(first([])).toBe(20260928)
		expect(first([marker({ day: 20260920, status: 'open', gen: null })])).toBe(20260920)
		expect(
			first([marker({ day: 20260920, status: 'dirty' })], new Date('2026-09-25T00:00:00.000Z'))
		).toBe(20260928)
		expect(
			aggregatePruneDay({ today: TODAY, aggregateDays: null, markers: [], prunedBefore: null })
		).toBeNull()
	})
})
