import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics, rebuildDays } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import type { HitRow } from '../../src/native/store/types'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit, storedHits } from './nativeHelpers'

/** Noon UTC on 20261007; the two days below are sealed. */
const NOW = new Date('2026-10-07T12:00:00.000Z')
const FIRST: CalendarDay = 20261004
const LAST: CalendarDay = 20261005

/** A landing from Google, at noon UTC so it falls on the same date in New York. */
const landing = (day: CalendarDay, visitor: string, more: Partial<HitRow>): HitRow => ({
	...pageviewHit({
		ts: new Date(calendarDayStart(day, 'UTC').getTime() + 12 * 3_600_000),
		v: visitor.padEnd(16, '0'),
	}),
	ref: 'google.com',
	source: 'google.com',
	...more,
})

describeForDb('native rebuilds', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock
	let zone = 'UTC'

	const read = (query: Partial<AnalyticsQuery>) =>
		adapter.query(
			{
				metrics: ['pageviews'],
				dimensions: ['channel'],
				dateRange: {
					start: calendarDayStart(FIRST, 'UTC'),
					end: new Date(calendarDayStart(addCalendarDays(LAST, 1), 'UTC').getTime() - 1),
				},
				...query,
			},
			{ payload: booted.payload }
		)

	const channels = async () =>
		(await read({})).rows.map((row) => [row.dimensions?.channel, row.metrics.pageviews])

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				reportingTimezone: () => zone,
			}),
		})
		// Classified by an older taxonomy, which called a search engine's visit a referral.
		await nativeOf(booted.payload).store.append([
			landing(FIRST, 'old-1', { channel: 'referral', channelVersion: 0 }),
			landing(LAST, 'old-2', { channel: 'referral', channelVersion: 0 }),
			landing(LAST, 'current', { channel: 'organic-search', channelVersion: 1 }),
		])
		await nativeOf(booted.payload).engine.maintain({ budgetMs: 120_000 })
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`reclassifies the hits of an older taxonomy and counts their days again on ${db}`, async () => {
		expect(await channels()).toEqual([
			['referral', 2],
			['organic-search', 1],
		])
		const report = await rebuildDays(booted.payload, {
			from: calendarDayStart(FIRST, 'UTC'),
			to: calendarDayStart(addCalendarDays(LAST, 1), 'UTC'),
			reclassify: true,
		})
		expect(report).toEqual({ reclassified: 2, dirty: 2 })
		const stored = await storedHits(booted.payload)
		expect(stored.map((hit) => [hit.channel, Number(hit.channelVersion)])).toEqual([
			['organic-search', 1],
			['organic-search', 1],
			['organic-search', 1],
		])
		const markers = await nativeOf(booted.payload).state.markers('', FIRST, LAST)
		expect(markers.map((marker) => marker.status)).toEqual(['dirty', 'dirty'])
		const maintained = await nativeOf(booted.payload).engine.maintain({ budgetMs: 120_000 })
		expect(maintained.aggregated).toBe(2)
		expect(await channels()).toEqual([['organic-search', 3]])
	})

	it(`rebuilds a stretch through the maintenance task's input on ${db}`, async () => {
		const job = await booted.payload.jobs.queue({
			task: MAINTAIN_TASK_SLUG,
			input: {
				rebuild: {
					from: calendarDayStart(FIRST, 'UTC').toISOString(),
					to: calendarDayStart(addCalendarDays(FIRST, 1), 'UTC').toISOString(),
				},
			},
		})
		const run = await booted.payload.jobs.runByID({ id: job.id })
		expect(run.jobStatus?.[String(job.id)]?.status).toBe('success')
		const [first] = await nativeOf(booted.payload).state.markers('', FIRST, FIRST)
		expect(first?.status).toBe('final')
		expect(await channels()).toEqual([['organic-search', 3]])
	})

	it(`counts days again in the zone their scope moved to in maintenance, read raw meanwhile with no call on ${db}`, async () => {
		zone = 'America/New_York'
		const moved = await read({
			dateRange: {
				start: calendarDayStart(FIRST, zone),
				end: new Date(calendarDayStart(addCalendarDays(FIRST, 1), zone).getTime() - 1),
			},
		})
		expect(moved.rows).toEqual([
			{ dimensions: { channel: 'organic-search' }, metrics: { pageviews: 1 } },
		])
		expect(moved.meta.partial).toBeUndefined()
		const zoneOf = async (day: CalendarDay) =>
			(await nativeOf(booted.payload).state.markers('', day, day))[0]?.tz
		// A runner just ran the task, so the read counts nothing and leaves it to the next run.
		expect(await zoneOf(FIRST)).toBe('UTC')
		const report = await nativeOf(booted.payload).engine.maintain({ budgetMs: 120_000 })
		expect(report.aggregated).toBeGreaterThanOrEqual(2)
		expect(await zoneOf(FIRST)).toBe(zone)
		expect(await zoneOf(LAST)).toBe(zone)
	})
})
