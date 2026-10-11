import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { dedupeKeyFor } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { dayWindow } from '../../src/native/store/aggregate'
import { DEFAULT_CAPS } from '../../src/native/store/caps'
import { createEventStore } from '../../src/native/store/eventStore'
import { orderHitId } from '../../src/native/store/ids'
import { compareCodePoints } from '../../src/native/store/rawRead'
import { DAY_LEASE_MS, dayKey } from '../../src/native/store/state'
import { createStateStore } from '../../src/native/store/stateStore'
import type { HitRow, StateStore } from '../../src/native/store/types'
import { calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit } from './nativeHelpers'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000

/** A server's record of a sale at `ts`, which came with no visitor. */
const order = (orderId: string, ts: Date): HitRow => ({
	...pageviewHit({ ts, v: '' }),
	id: orderHitId(dedupeKeyFor({ origin: 'server', goal: 'purchase', orderId })),
	type: 'goal',
	path: '/orders',
	server: true,
})

describeForDb('native day leases and order paging', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' }, jobs: false }),
		})
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	/** Counts a day under `run-1`'s lease, running `during` after counting and before any write. */
	const countWith = async (day: number, during: (state: StateStore) => Promise<void>) => {
		const state = createStateStore(booted.payload)
		const store = createEventStore(booted.payload, { hooks: { beforeWrite: () => during(state) } })
		await store.append([
			pageviewHit({
				ts: new Date(calendarDayStart(day, 'UTC').getTime() + 60 * MINUTE),
				v: `lease-${day}`.padEnd(16, '0'),
			}),
		])
		await state.ensureMarkers([{ scope: '', day, tz: 'UTC' }])
		expect(await state.claim(dayKey('', day), 'run-1', DAY_LEASE_MS)).toBe(true)
		const result = await store.aggregateDay(dayWindow('', day, 'UTC'), {
			runId: 'run-1',
			caps: DEFAULT_CAPS,
			status: 'final',
		})
		const [marker] = await state.markers('', day, day)
		return { result, marker, state }
	}

	it(`never lets a count a dirty mark revoked complete, even once its lease ran out, on ${db}`, async () => {
		const { result, marker } = await countWith(20261003, async (state) => {
			await state.markDirty('', [20261003])
			clock.advance(DAY_LEASE_MS + MINUTE)
		})
		expect(result.completed).toBe(false)
		expect(marker).toMatchObject({ status: 'dirty', leaseOwner: null, gen: null })
	})

	it(`hands a day marked dirty mid-count to the next run at once, on ${db}`, async () => {
		const { result, marker, state } = await countWith(20261004, async (dirty) => {
			await dirty.markDirty('', [20261004])
		})
		expect(result.completed).toBe(false)
		expect(marker).toMatchObject({ status: 'dirty', leaseOwner: null, leaseUntil: null })
		expect((await state.pending(clock.now(), 10)).map((due) => due.day)).toContain(20261004)
		expect(await state.claim(dayKey('', 20261004), 'run-2', DAY_LEASE_MS)).toBe(true)
	})

	it(`pages a scope's orders by time and then id, never skipping one sharing a millisecond, on ${db}`, async () => {
		const { store } = nativeOf(booted.payload)
		const ts = new Date(clock.now().getTime() - 5 * MINUTE)
		const orders = ['a', 'b', 'c', 'd', 'e'].map((id) => order(`paged-${id}`, ts))
		await store.append(orders)
		const window = {
			scope: '',
			start: new Date(ts.getTime() - MINUTE),
			end: clock.now(),
		}
		const first = await store.ordersIn({ ...window, limit: 2 })
		const second = await store.ordersIn({ ...window, limit: 2, after: first.at(-1) })
		const third = await store.ordersIn({ ...window, limit: 2, after: second.at(-1) })
		expect([...first, ...second, ...third].map((each) => each.id)).toEqual(
			orders.map((each) => each.id).sort(compareCodePoints)
		)
		expect(third).toHaveLength(1)
	})

	it(`sweeps every order stored since the last pass, however many share a millisecond, on ${db}`, async () => {
		const { store, engine } = nativeOf(booted.payload)
		clock.advance(20 * MINUTE)
		await engine.maintain({ budgetMs: 120_000 })
		const ts = new Date(clock.now().getTime() - MINUTE)
		await store.append(Array.from({ length: 1_001 }, (_, index) => order(`swept-${index}`, ts)))
		clock.advance(5 * MINUTE)
		expect((await engine.maintain({ budgetMs: 120_000 })).sweptOrders).toBe(1_001)
	})
})
