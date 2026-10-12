import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { createEngine } from '../../src/native/engine/engine'
import { nativeInstanceOf } from '../../src/native/engine/instance'
import { native } from '../../src/native/nativeAdapter'
import { ulid } from '../../src/native/store/ids'
import { dayKey } from '../../src/native/store/state'
import type { HitRow, StateStore } from '../../src/native/store/types'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
} from '../../src/timeframe/calendar'

const hit = (day: CalendarDay, v: string): HitRow => {
	const ts = new Date(calendarDayStart(day, 'UTC').getTime() + 3_600_000)
	return {
		id: ulid(ts),
		scope: '',
		ts,
		type: 'pageview',
		hostname: 'h',
		path: '/p',
		v: v.padEnd(16, 'x'),
		landing: true,
		server: false,
	}
}

/**
 * A backdated server hit stores and reopens its day between the probe that found the day empty
 * and the lease that would mark it so.
 */
describeForDb('empty marker race', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ retention: { rawDays: 30 } })],
				capture: { gate: 'off' },
				jobs: false,
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`counts a day a server hit reached between its probe and its empty marking, on ${db}`, async () => {
		const instance = nativeInstanceOf(booted.payload)
		if (!instance) throw new Error('no native instance')
		const today = calendarDayOf(new Date(), 'UTC')
		const first = addCalendarDays(today, -8)
		const raced = addCalendarDays(today, -6)
		const last = addCalendarDays(today, -4)
		await instance.store.append([hit(first, 'v1'), hit(last, 'v5')])
		let fired = false
		const reopen: { day?: (day: CalendarDay) => Promise<void> } = {}
		const base = instance.state
		const state: StateStore = {
			...base,
			claim: async (key, owner, ttl) => {
				if (!fired && key === dayKey('', raced)) {
					fired = true
					await instance.store.append([hit(raced, 'v3')])
					await reopen.day?.(raced)
				}
				return base.claim(key, owner, ttl)
			},
		}
		const engine = createEngine({
			payload: booted.payload,
			store: instance.store,
			state,
			options: { timezone: () => 'UTC', rawDays: 30 },
		})
		reopen.day = (day) => engine.reopen({ scope: '', day, tz: 'UTC' })
		try {
			await engine.maintain({ budgetMs: 60_000 })
			const [raceMarker] = await base.markers('', raced, raced)
			expect(fired).toBe(true)
			expect(raceMarker?.status).toBe('dirty')
			await engine.maintain({ budgetMs: 60_000 })
			const [counted] = await base.markers('', raced, raced)
			expect(counted).toMatchObject({ status: 'final', hits: 1 })
			const answer = await engine.read({
				metrics: ['pageviews'],
				timezone: 'UTC',
				dateRange: {
					start: calendarDayStart(first, 'UTC'),
					end: new Date(calendarDayStart(addCalendarDays(last, 1), 'UTC').getTime() - 1),
				},
			})
			expect(answer.totals).toEqual({ pageviews: 3 })
		} finally {
			await engine.close()
		}
	})
})
