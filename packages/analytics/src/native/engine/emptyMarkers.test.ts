import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { type CalendarDay, calendarDayStart } from '../../timeframe/calendar'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import { dayKey } from '../store/state'
import type { EventStore, HitRow, StateStore } from '../store/types'
import { createEngine, type NativeEngine } from './engine'

const MINUTE = 60_000
const NOON = new Date('2026-10-07T12:00:00.000Z')
const RACED = 20261003

let serial = 0

const hitOn = (scope: string, day: CalendarDay, minutes = 60): HitRow => {
	serial += 1
	return {
		id: `E${String(serial).padStart(9, '0')}`,
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

const quiet = { logger: { warn: () => undefined } }

interface Rig {
	store: EventStore
	state: StateStore
	engine: NativeEngine
	warnings: string[]
}

/**
 * An engine whose state store runs `before` ahead of every day-lease claim: a server hit and its
 * reopen land between the probe that found the day empty and the lease that marks it so.
 */
const rig = async (
	hits: readonly HitRow[],
	before: (key: string, rig: Rig) => Promise<void>,
	wrapState: (state: StateStore) => StateStore = (state) => state
): Promise<Rig> => {
	const now = () => NOON
	const base = memoryStateStore({ now })
	const parts: Partial<Rig> = { warnings: [] }
	const state = wrapState({
		...base,
		claim: async (key, owner, ttl) => {
			if (parts.store && parts.engine && parts.state && parts.warnings) {
				await before(key, {
					store: parts.store,
					engine: parts.engine,
					state: parts.state,
					warnings: parts.warnings,
				})
			}
			return base.claim(key, owner, ttl)
		},
	})
	const store = memoryEventStore({ state, now })
	const warnings: string[] = []
	const engine = createEngine({
		payload: quiet as unknown as Payload,
		store,
		state,
		options: {
			now,
			clock: () => 0,
			warn: (message) => warnings.push(message),
			scoped: true,
			rawDays: 30,
		},
	})
	Object.assign(parts, { store, state, engine, warnings })
	await store.append(hits)
	return { store, state, engine, warnings }
}

/** Stores a backdated server hit on the raced day and reopens it, as server tracking does, once. */
const raceOnce = () => {
	let fired = false
	const before = async (key: string, at: Rig): Promise<void> => {
		if (!fired && key === dayKey('a', RACED)) {
			fired = true
			await at.store.append([hitOn('a', RACED)])
			await at.engine.reopen({ scope: 'a', day: RACED, tz: 'UTC' })
		}
	}
	return { before, fired: () => fired }
}

const week = {
	metrics: ['pageviews' as const],
	scope: 'a',
	timezone: 'UTC',
	dateRange: {
		start: calendarDayStart(20261001, 'UTC'),
		end: new Date(calendarDayStart(20261006, 'UTC').getTime() - 1),
	},
}

describe('a day found without hits, raced by a backdated server hit', () => {
	it('is counted, never marked empty, when the hit lands before maintenance claims it', async () => {
		const race = raceOnce()
		const ready = await rig([hitOn('a', 20261001), hitOn('a', 20261005)], race.before)
		await ready.engine.maintain({ budgetMs: 60_000 })
		const [first] = await ready.state.markers('a', RACED, RACED)
		expect(race.fired()).toBe(true)
		expect(first?.status).toBe('dirty')
		await ready.engine.maintain({ budgetMs: 60_000 })
		const [counted] = await ready.state.markers('a', RACED, RACED)
		expect(counted).toMatchObject({ status: 'final', hits: 1 })
		const answer = await ready.engine.read(week)
		await ready.engine.idle()
		expect(answer.totals).toEqual({ pageviews: 3 })
	})

	it('is counted when the hit lands between a read’s probe and its background empty marking', async () => {
		const race = raceOnce()
		const ready = await rig([hitOn('a', 20261001), hitOn('a', 20261005)], race.before)
		await ready.engine.read(week)
		await ready.engine.idle()
		expect(race.fired()).toBe(true)
		await ready.engine.maintain({ budgetMs: 60_000 })
		const [marker] = await ready.state.markers('a', RACED, RACED)
		expect(marker?.status).not.toBe('empty')
		const answer = await ready.engine.read(week)
		await ready.engine.idle()
		expect(answer.totals).toEqual({ pageviews: 3 })
	})

	it('keeps a day dirtied after the claim from being completed empty', async () => {
		let fired = false
		const ready = await rig(
			[hitOn('a', 20261001), hitOn('a', 20261005)],
			async () => {},
			(state) => ({
				...state,
				complete: async (marker, owner, guard) => {
					if (!fired && marker.status === 'empty' && marker.day === RACED) {
						fired = true
						await state.markDirty('a', [RACED])
					}
					return state.complete(marker, owner, guard)
				},
			})
		)
		await ready.engine.maintain({ budgetMs: 60_000 })
		expect(fired).toBe(true)
		const [marker] = await ready.state.markers('a', RACED, RACED)
		expect(marker).toMatchObject({ status: 'dirty', leaseOwner: null })
	})

	it('marks a day empty that still holds no hit once its lease is held', async () => {
		const ready = await rig([hitOn('a', 20261001), hitOn('a', 20261005)], async () => {})
		await ready.engine.maintain({ budgetMs: 60_000 })
		const [marker] = await ready.state.markers('a', RACED, RACED)
		expect(marker).toMatchObject({ status: 'empty', leaseOwner: null, leaseUntil: null })
	})

	it('gives the lease back when the completion is refused or throws, and carries on with the next scope', async () => {
		const ready = await rig(
			[hitOn('a', 20261001), hitOn('a', 20261005), hitOn('b', 20261001), hitOn('b', 20261005)],
			async () => {},
			(state) => ({
				...state,
				complete: async (marker, owner, guard) => {
					if (marker.status === 'empty' && marker.scope === 'a') {
						throw new Error('state store down')
					}
					return state.complete(marker, owner, guard)
				},
			})
		)
		const report = await ready.engine.maintain({ budgetMs: 60_000 })
		expect(report.finished).toBe(true)
		// Newest first: the day whose completion threw keeps its open marker, the rest get none.
		const [a] = await ready.state.markers('a', 20261004, 20261004)
		expect(a).toMatchObject({ status: 'open', leaseOwner: null })
		expect(await ready.state.markers('a', 20261002, RACED)).toEqual([])
		const [b] = await ready.state.markers('b', RACED, RACED)
		expect(b?.status).toBe('empty')
		expect(ready.warnings.some((line) => line.includes('scope "a"'))).toBe(true)
	})
})
