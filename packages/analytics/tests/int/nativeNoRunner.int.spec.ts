import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { NUDGE_EVERY_MS } from '../../src/native/engine/nudge'
import { native } from '../../src/native/nativeAdapter'
import { leaseKey } from '../../src/native/store/state'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit, postBeacon } from './nativeHelpers'

/** Noon UTC on 20261007: yesterday is closed. */
const NOW = new Date('2026-10-07T12:00:00.000Z')
const YESTERDAY = 20261006

describeForDb('native without a jobs runner', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock
	let leases: () => number

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' }, jobs: false }),
		})
		const { store, state } = nativeOf(booted.payload)
		await store.append([
			pageviewHit({
				ts: new Date(calendarDayStart(YESTERDAY, 'UTC').getTime() + 3_600_000),
				v: 'yesterday-visitor',
			}),
		])
		const claim = vi.spyOn(state, 'claim')
		leases = () => claim.mock.calls.filter(([key]) => key === leaseKey('maintain')).length
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	const beacon = async (path: string) => {
		const response = await postBeacon(booted.payload, { type: 'pageview', path })
		expect(response.status).toBe(202)
	}

	it(`registers no task with jobs: false on ${db}`, () => {
		const slugs = (booted.payload.config.jobs.tasks ?? []).map((task) => task.slug)
		expect(slugs).not.toContain(MAINTAIN_TASK_SLUG)
	})

	it(`starts maintenance from ingest exactly once per window, never on the request on ${db}`, async () => {
		await beacon('/one')
		await beacon('/two')
		await beacon('/three')
		await nativeOf(booted.payload).engine.idle()
		expect(leases()).toBe(1)
		const [yesterday] = await nativeOf(booted.payload).state.markers('', YESTERDAY, YESTERDAY)
		expect(yesterday?.status).toBe('provisional')
		clock.advance(NUDGE_EVERY_MS - 1)
		await beacon('/four')
		await nativeOf(booted.payload).engine.idle()
		expect(leases()).toBe(1)
		clock.advance(1)
		await beacon('/five')
		await nativeOf(booted.payload).engine.idle()
		expect(leases()).toBe(2)
		expect(await nativeOf(booted.payload).state.lastBeat(MAINTAIN_TASK_SLUG)).toBeNull()
	})

	it(`still answers reads, today live and closed days from their totals on ${db}`, async () => {
		const today = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: { start: calendarDayStart(20261007, 'UTC'), end: clock.now() },
			},
			{ payload: booted.payload }
		)
		expect(today.totals).toEqual({ pageviews: 5 })
		const closed = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: {
					start: calendarDayStart(YESTERDAY, 'UTC'),
					end: new Date(calendarDayStart(addCalendarDays(YESTERDAY, 1), 'UTC').getTime() - 1),
				},
			},
			{ payload: booted.payload }
		)
		expect(closed.totals).toEqual({ pageviews: 1 })
		expect(closed.meta.partial).toBeUndefined()
	})
})
