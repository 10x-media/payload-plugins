import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { nativeInstanceOf } from '../../src/native/engine/instance'
import { native } from '../../src/native/nativeAdapter'
import { leaseKey } from '../../src/native/store/state'
import { isDestroyed } from '../../src/plugin/destroy'
import { calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit, postBeacon } from './nativeHelpers'

const NOW = new Date('2026-10-07T12:00:00.000Z')

describeForDb('native shutdown', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' }, jobs: false }),
		})
		await nativeOf(booted.payload).store.append(
			Array.from({ length: 30 }, (_, day) =>
				pageviewHit({
					ts: new Date(calendarDayStart(20260901 + day, 'UTC').getTime() + 3_600_000),
					v: `shutdown-${day}`.padEnd(16, '0'),
				})
			)
		)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`closes the engine when Payload is destroyed, after the work it started, and starts none after on ${db}`, async () => {
		const instance = nativeOf(booted.payload)
		const close = vi.spyOn(adapter, 'close')
		const claim = vi.spyOn(instance.state, 'claim')
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		// The beacon's nudge starts maintenance in the background, unawaited.
		expect((await postBeacon(booted.payload, { type: 'pageview', path: '/late' })).status).toBe(202)
		expect(claim.mock.calls.some(([key]) => key === leaseKey('maintain'))).toBe(true)

		await booted.payload.destroy()
		expect(isDestroyed(booted.payload)).toBe(true)
		expect(close).toHaveBeenCalledTimes(1)
		expect(close).toHaveBeenCalledWith(booted.payload)
		expect(nativeInstanceOf(booted.payload)).toBeUndefined()

		const settled = claim.mock.calls.length
		instance.nudge()
		await instance.engine.idle()
		expect(await instance.engine.maintain({ budgetMs: 60_000 })).toMatchObject({ ran: false })
		expect(claim.mock.calls.length).toBe(settled)
		await expect(
			adapter.query(
				{ metrics: ['pageviews'], dateRange: { start: NOW, end: NOW } },
				{ payload: booted.payload }
			)
		).rejects.toThrow(/was destroyed/)
		expect(warn.mock.calls.filter(([message]) => String(message).includes('failed'))).toEqual([])
	})
})
