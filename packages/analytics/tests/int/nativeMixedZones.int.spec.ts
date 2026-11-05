import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit } from './nativeHelpers'

/** Every day below is sealed by then. */
const NOW = new Date('2026-10-07T12:00:00.000Z')

/** The platform reads in New York; its tenants count their own days in Berlin and Los Angeles. */
const REPORTING = 'America/New_York'
const ZONES: Record<string, string> = { east: 'Europe/Berlin', west: 'America/Los_Angeles' }

const FIRST: CalendarDay = 20261001
const LAST: CalendarDay = 20261003

/** Oct 1 to Oct 3 in New York, as the query endpoint reads `from=2026-10-01&to=2026-10-03`. */
const RANGE = {
	start: calendarDayStart(FIRST, REPORTING),
	end: new Date(calendarDayStart(20261004, REPORTING).getTime() - 1),
}

const hit = (scope: string, iso: string, visitor: string) =>
	pageviewHit({ scope, ts: new Date(iso), v: visitor.padEnd(16, '0') })

describeForDb('native reads over scopes counted in other zones', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock

	const read = (query: Partial<AnalyticsQuery>): Promise<AnalyticsResult> =>
		adapter.query(
			{ metrics: ['pageviews'], dateRange: RANGE, timezone: REPORTING, ...query },
			{ payload: booted.payload }
		)

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { resolve: () => null, member: () => true },
				access: { crossScope: () => true },
				reportingTimezone: ({ scope }) => (scope ? (ZONES[scope] ?? REPORTING) : REPORTING),
			}),
		})
		await nativeOf(booted.payload).store.append([
			// 01:00 Oct 1 in New York is still Sep 30 in Los Angeles: in range, on a west date before it.
			hit('west', '2026-10-01T05:00:00.000Z', 'w1'),
			hit('west', '2026-10-02T16:00:00.000Z', 'w2'),
			hit('east', '2026-10-02T16:00:00.000Z', 'e1'),
			// 20:00 Oct 3 in New York is already Oct 4 in Berlin: in the range, on an east date after it.
			hit('east', '2026-10-04T00:00:00.000Z', 'e2'),
			// Outside the range in New York, whatever the tenants' own dates say.
			hit('west', '2026-10-01T03:00:00.000Z', 'w3'),
			hit('east', '2026-10-04T05:00:00.000Z', 'e3'),
		])
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	const total = (result: AnalyticsResult): number =>
		result.rows.reduce((sum, row) => sum + (row.metrics.pageviews ?? 0), 0)

	it(`counts what happened inside the range's instants, and nothing else, on ${db}`, async () => {
		const result = await read({})
		expect(result.totals).toEqual({ pageviews: 4 })
	})

	it(`files every day of the series within the range, adding up to its totals, on ${db}`, async () => {
		const result = await read({ granularity: 'day' })
		expect(result.rows.map((row) => [row.timestamp, row.metrics.pageviews])).toEqual([
			[calendarDayStart(20261001, REPORTING).toISOString(), 1],
			[calendarDayStart(20261002, REPORTING).toISOString(), 2],
			[calendarDayStart(20261003, REPORTING).toISOString(), 1],
		])
		expect(total(result)).toBe(result.totals?.pageviews)
	})

	it(`keeps a week series to the weeks the range touches on ${db}`, async () => {
		const result = await read({ granularity: 'week' })
		expect(result.rows.map((row) => row.timestamp)).toEqual([
			calendarDayStart(20260928, REPORTING).toISOString(),
		])
		expect(total(result)).toBe(4)
	})

	it(`reads one tenant in its own zone by its own days on ${db}`, async () => {
		const west = ZONES.west ?? REPORTING
		const result = await read({
			scope: 'west',
			timezone: west,
			dateRange: {
				start: calendarDayStart(FIRST, west),
				end: new Date(calendarDayStart(20261004, west).getTime() - 1),
			},
			granularity: 'day',
		})
		expect(result.rows.map((row) => [row.timestamp, row.metrics.pageviews])).toEqual([
			[calendarDayStart(20261002, west).toISOString(), 1],
		])
		expect(total(result)).toBe(result.totals?.pageviews)
	})

	it(`keeps an hour series inside the range on ${db}`, async () => {
		const start = calendarDayStart(LAST, REPORTING)
		const result = await read({
			dateRange: { start, end: RANGE.end },
			granularity: 'hour',
		})
		expect(result.rows.every((row) => Date.parse(row.timestamp ?? '') >= start.getTime())).toBe(
			true
		)
		expect(total(result)).toBe(result.totals?.pageviews)
		expect(result.totals).toEqual({ pageviews: 1 })
	})
})

describeForDb('native reads cutting a day of another zone past raw retention', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const zones: Record<string, string> = {
		east: 'Europe/Berlin',
		west: 'America/Los_Angeles',
		'west-old': 'America/Los_Angeles',
		'east-old': 'Europe/Berlin',
	}
	/** New York's Oct 5 and 6: Los Angeles' Oct 4 runs into it, past its raw floor (Oct 5). */
	const range = {
		start: calendarDayStart(20261005, REPORTING),
		end: new Date(calendarDayStart(20261007, REPORTING).getTime() - 1),
	}

	const read = (): Promise<AnalyticsResult> =>
		nativeOf(booted.payload).engine.read({
			metrics: ['pageviews'],
			dateRange: range,
			timezone: REPORTING,
		})

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ retention: { rawDays: 3 } })],
				capture: { gate: 'off' },
				jobs: false,
				scope: { resolve: () => null, member: () => true },
				access: { crossScope: () => true },
				reportingTimezone: ({ scope }) => (scope ? (zones[scope] ?? REPORTING) : REPORTING),
			}),
		})
		await nativeOf(booted.payload).store.append([
			hit('west', '2026-10-05T16:00:00.000Z', 'w1'),
			hit('west', '2026-10-06T16:00:00.000Z', 'w2'),
			hit('east', '2026-10-05T16:00:00.000Z', 'e1'),
		])
		await nativeOf(booted.payload).engine.maintain({ budgetMs: 60_000 })
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`leaves out a cut day that held no hits, never waiting to count it, on ${db}`, async () => {
		const result = await read()
		expect(result.meta.partial).toBeUndefined()
		expect(result.meta.clamped).toBeUndefined()
		expect(result.totals).toEqual({ pageviews: 3 })
	})

	it(`starts the read after a cut day whose hits are gone, rather than calling it uncounted, on ${db}`, async () => {
		const { store, engine } = nativeOf(booted.payload)
		// 22:00 Oct 4 in Los Angeles: inside New York's Oct 5, on a day past the raw floor.
		await store.append([hit('west-old', '2026-10-05T05:00:00.000Z', 'o1')])
		await engine.maintain({ budgetMs: 60_000 })
		expect(await store.oldestHit('west-old')).toBeNull()
		const result = await read()
		expect(result.meta.partial).toBeUndefined()
		expect(result.meta).toMatchObject({
			clamped: true,
			dataFrom: calendarDayStart(20261005, 'America/Los_Angeles').toISOString(),
		})
	})

	it(`ends the read before a cut last day whose hits are gone, rather than calling it uncounted, on ${db}`, async () => {
		const { store, engine } = nativeOf(booted.payload)
		// 03:00 Oct 4 in Berlin: inside New York's Oct 3, on a Berlin day past the raw floor.
		await store.append([hit('east-old', '2026-10-04T01:00:00.000Z', 'b1')])
		await engine.maintain({ budgetMs: 60_000 })
		expect(await store.oldestHit('east-old')).toBeNull()
		const result = await nativeOf(booted.payload).engine.read({
			metrics: ['pageviews'],
			timezone: REPORTING,
			dateRange: {
				start: calendarDayStart(20261001, REPORTING),
				end: new Date(calendarDayStart(20261004, REPORTING).getTime() - 1),
			},
		})
		expect(result.meta.partial).toBeUndefined()
		expect(result.meta).toMatchObject({
			clamped: true,
			dataTo: calendarDayStart(20261004, 'Europe/Berlin').toISOString(),
		})
	})
})
