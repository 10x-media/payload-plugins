import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { calendarDayStart } from '../../timeframe/calendar'
import { memoryStateStore } from '../store/memory/memoryState'
import { memoryEventStore } from '../store/memory/memoryStore'
import { leaseKey } from '../store/state'
import type { StateStore } from '../store/types'
import { MAINTAIN_TASK_SLUG } from '../tasks/maintainTask'
import { createEngine, type EngineOptions } from './engine'
import { createNudger, NUDGE_EVERY_MS } from './nudge'

const MINUTE = 60_000

/** Lets every settled promise run its callbacks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createNudger', () => {
	it('starts at most once per window by its clock', async () => {
		let now = 0
		const start = vi.fn(async () => undefined)
		const nudger = createNudger({ now: () => now, everyMs: NUDGE_EVERY_MS, start })
		nudger.nudge()
		await settle()
		nudger.nudge()
		now += NUDGE_EVERY_MS - 1
		nudger.nudge()
		expect(start).toHaveBeenCalledTimes(1)
		now += 1
		nudger.nudge()
		expect(start).toHaveBeenCalledTimes(2)
	})

	it('never starts while the previous start still runs, however long it takes', async () => {
		let now = 0
		let finish: () => void = () => undefined
		const start = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				})
		)
		const nudger = createNudger({ now: () => now, everyMs: NUDGE_EVERY_MS, start })
		nudger.nudge()
		now += 3 * NUDGE_EVERY_MS
		nudger.nudge()
		expect(start).toHaveBeenCalledTimes(1)
		finish()
		await settle()
		nudger.nudge()
		expect(start).toHaveBeenCalledTimes(2)
	})
})

describe('the engine’s nudge', () => {
	const NOON = new Date('2026-10-07T12:00:00.000Z')

	/** An engine over memory stores whose maintenance lease claims and salt sweeps are counted. */
	const rig = async (options: EngineOptions) => {
		const at = { now: NOON.getTime() }
		const now = () => new Date(at.now)
		const base = memoryStateStore({ now })
		const calls = { leases: 0, sweeps: 0 }
		const state: StateStore = {
			...base,
			claim: (key, owner, ttl) => {
				if (key === leaseKey('maintain')) {
					calls.leases += 1
				}
				return base.claim(key, owner, ttl)
			},
			sweep: (when) => {
				calls.sweeps += 1
				return base.sweep(when)
			},
		}
		const store = memoryEventStore({ state, now })
		await store.append([
			{
				id: 'N1',
				scope: '',
				ts: new Date(calendarDayStart(20261005, 'UTC').getTime() + 60 * MINUTE),
				type: 'pageview',
				hostname: 'a.example',
				path: '/',
				v: 'nudged-visitor-1',
				landing: true,
				server: false,
			},
		])
		const engine = createEngine({
			payload: { logger: { warn: () => undefined } } as unknown as Payload,
			store,
			state,
			options: { now, warn: () => undefined, ...options },
		})
		return { engine, state, calls, at }
	}

	it('runs a short maintenance once per window without a jobs runner', async () => {
		const { engine, state, calls, at } = await rig({ maintenance: { runner: false } })
		engine.nudge()
		engine.nudge()
		await engine.idle()
		expect(calls.leases).toBe(1)
		const [marker] = await state.markers('', 20261005, 20261005)
		expect(marker?.status).toBe('final')
		engine.nudge()
		await engine.idle()
		expect(calls.leases).toBe(1)
		at.now += NUDGE_EVERY_MS
		engine.nudge()
		await engine.idle()
		expect(calls.leases).toBe(2)
		expect(await state.lastBeat(MAINTAIN_TASK_SLUG)).toBeNull()
	})

	it('only sweeps salts while a jobs runner’s heartbeat is fresh, and steps in once it is stale', async () => {
		const { engine, state, calls, at } = await rig({
			maintenance: { runner: true, intervalMs: 15 * MINUTE },
		})
		await state.beat(MAINTAIN_TASK_SLUG)
		at.now += 29 * MINUTE
		engine.nudge()
		await engine.idle()
		expect(calls).toEqual({ leases: 0, sweeps: 1 })
		at.now += 2 * MINUTE
		at.now += NUDGE_EVERY_MS
		engine.nudge()
		await engine.idle()
		expect(calls.leases).toBe(1)
	})

	it('treats a runner that never beat as missing', async () => {
		const { engine, calls } = await rig({ maintenance: { runner: true } })
		engine.nudge()
		await engine.idle()
		expect(calls.leases).toBe(1)
	})
})
