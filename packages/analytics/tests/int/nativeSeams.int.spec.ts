import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { localDay } from '../../src/native/engine/days'
import { createEngine, type EngineOptions, type NativeEngine } from '../../src/native/engine/engine'
import { native } from '../../src/native/nativeAdapter'
import { createEventStore } from '../../src/native/store/eventStore'
import { ulid } from '../../src/native/store/ids'
import { createStateStore } from '../../src/native/store/stateStore'
import type { EventStore, HitRow, StateStore } from '../../src/native/store/types'
import { type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'

const NOON = new Date('2026-10-07T12:00:00.000Z')

/** A landing on `/` at `ts`, by a visitor of its own, in `scope`. */
const pv = (scope: string, ts: string, visitor: string): HitRow => ({
	id: ulid(new Date(ts)),
	scope,
	ts: new Date(ts),
	type: 'pageview',
	hostname: 'h',
	path: '/',
	v: visitor.padEnd(16, '0'),
	landing: true,
	server: false,
	source: 'direct',
	channel: 'direct',
})

const days = (from: CalendarDay, to: CalendarDay, tz = 'UTC'): AnalyticsQuery['dateRange'] => ({
	start: calendarDayStart(from, tz),
	end: new Date(localDay(to, tz).end.getTime() - 1),
})

describeForDb('native day windows across zones and scopes', {}, (db) => {
	let booted: BootedPayload
	let store: EventStore
	let state: StateStore
	const clock = { at: NOON.getTime() }
	const now = (): Date => new Date(clock.at)
	/** Each scope's zone, as its resolver answers it; a missing one throws. */
	const zones = new Map<string, string>()
	const warnings: string[] = []

	const engine = (options: EngineOptions = {}): NativeEngine =>
		createEngine({
			payload: booted.payload,
			store,
			state,
			options: {
				now,
				scoped: true,
				timezone: (scope) => {
					const tz = zones.get(scope)
					if (tz === undefined) {
						throw new Error(`no zone for ${scope}`)
					}
					return tz
				},
				warn: (message) => warnings.push(message),
				...options,
			},
		})

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

	/**
	 * Seven hits, three days of raw hits kept: a first run in `from` prunes the oldest; the zone
	 * moves to `to`, with or without a read that day, and two more runs follow, a day apart.
	 */
	const change = async (
		scope: string,
		{ from, to, readOnTheDay }: { from: string; to: string; readOnTheDay: boolean }
	) => {
		clock.at = NOON.getTime()
		zones.set(scope, from)
		await store.append(
			[
				'2026-10-03T12:00:00.000Z',
				'2026-10-04T16:00:00.000Z',
				'2026-10-04T20:00:00.000Z',
				'2026-10-05T10:00:00.000Z',
				'2026-10-05T18:00:00.000Z',
				'2026-10-06T10:00:00.000Z',
				'2026-10-07T01:00:00.000Z',
			].map((ts, i) => pv(scope, ts, `${scope}-${i}`))
		)
		const counting = engine({ rawDays: 3, maintenance: { runner: true } })
		await counting.maintain({ budgetMs: 120_000 })
		zones.set(scope, to)
		const query: AnalyticsQuery = {
			scope,
			metrics: ['pageviews'],
			granularity: 'day',
			dateRange: days(20261004, 20261006, to),
		}
		const series = async () =>
			(await counting.read(query)).rows.map((row) => [row.timestamp, row.metrics.pageviews])
		const early = readOnTheDay ? await series() : null
		await counting.maintain({ budgetMs: 120_000 })
		clock.at = new Date('2026-10-08T12:00:00.000Z').getTime()
		await counting.maintain({ budgetMs: 120_000 })
		await counting.idle()
		return { early, late: await series() }
	}

	it(`starts the first day counted in a zone east of the old one where the last old day ended on ${db}`, async () => {
		const expected = [
			['2026-10-03T15:00:00.000Z', 2],
			['2026-10-04T15:00:00.000Z', 1],
			['2026-10-05T15:00:00.000Z', 2],
		]
		const read = await change('east-read', { from: 'UTC', to: 'Asia/Tokyo', readOnTheDay: true })
		const quiet = await change('east-quiet', { from: 'UTC', to: 'Asia/Tokyo', readOnTheDay: false })
		expect(read).toEqual({ early: expected, late: expected })
		expect(quiet.late).toEqual(expected)
		const [seam] = await state.markers('east-quiet', 20261005, 20261005)
		expect(seam?.start).toEqual(new Date('2026-10-05T00:00:00.000Z'))
	})

	it(`starts the first day counted in a zone west of the old one where the last old day ended on ${db}`, async () => {
		const expected = [
			['2026-10-04T00:00:00.000Z', 2],
			['2026-10-05T00:00:00.000Z', 2],
			['2026-10-06T00:00:00.000Z', 1],
		]
		const read = await change('west-read', { from: 'Asia/Tokyo', to: 'UTC', readOnTheDay: true })
		const quiet = await change('west-quiet', { from: 'Asia/Tokyo', to: 'UTC', readOnTheDay: false })
		expect(read).toEqual({ early: expected, late: expected })
		expect(quiet.late).toEqual(expected)
	})

	it(`reads a scope with no zone ever recorded in UTC, writing nothing, and says so on ${db}`, async () => {
		clock.at = NOON.getTime()
		await store.append([
			pv('zoneless', '2026-10-05T10:00:00.000Z', 'zoneless-1'),
			pv('zoneless', '2026-10-06T10:00:00.000Z', 'zoneless-2'),
		])
		const reader = engine()
		const answer = await reader.read({
			scope: 'zoneless',
			metrics: ['pageviews'],
			dateRange: days(20261001, 20261007),
		})
		await reader.idle()
		expect(answer.totals).toEqual({ pageviews: 2 })
		expect(answer.meta.timezoneUnresolved).toBe(true)
		expect(await state.markers('zoneless', 20261001, 20261007)).toEqual([])
	})

	it(`keeps the zone a scope's newest counted day was counted in, in a fresh engine on ${db}`, async () => {
		clock.at = NOON.getTime()
		zones.set('recorded', 'Asia/Tokyo')
		await store.append([
			pv('recorded', '2026-10-04T20:00:00.000Z', 'recorded-1'),
			pv('recorded', '2026-10-05T10:00:00.000Z', 'recorded-2'),
			pv('recorded', '2026-10-05T20:00:00.000Z', 'recorded-3'),
		])
		await engine().maintain({ budgetMs: 120_000 })
		zones.delete('recorded')
		const fresh = engine()
		const answer = await fresh.read({
			scope: 'recorded',
			metrics: ['pageviews'],
			granularity: 'day',
			dateRange: days(20261004, 20261006, 'Asia/Tokyo'),
		})
		await fresh.idle()
		expect(answer.meta.timezoneUnresolved).toBeUndefined()
		expect(answer.rows.map((row) => row.metrics.pageviews)).toEqual([2, 1])
		const markers = await state.markers('recorded', 20261004, 20261006)
		expect(markers.every((marker) => marker.tz === 'Asia/Tokyo')).toBe(true)
	})

	it(`prunes a scope whose zone never resolves by a zone-free cut, warning each run, on ${db}`, async () => {
		clock.at = NOON.getTime()
		warnings.length = 0
		await store.append([
			pv('broken', '2026-09-01T10:00:00.000Z', 'broken-1'),
			pv('broken', '2026-10-06T10:00:00.000Z', 'broken-2'),
		])
		const pruning = engine({ rawDays: 3 })
		await pruning.maintain({ budgetMs: 120_000 })
		await pruning.maintain({ budgetMs: 120_000 })
		expect(await store.oldestHit('broken')).toEqual(new Date('2026-10-06T10:00:00.000Z'))
		expect(await state.prunedBefore('broken')).toEqual(new Date('2026-10-04T10:00:00.000Z'))
		expect(
			warnings.filter((message) => message.includes('"broken" has never resolved'))
		).toHaveLength(2)
	})

	it(`reads every scope with day markers, its raw hits pruned or not, on ${db}`, async () => {
		clock.at = new Date('2026-09-10T12:00:00.000Z').getTime()
		zones.set('gone', 'UTC')
		await store.append([pv('gone', '2026-09-01T10:00:00.000Z', 'gone-1')])
		const reading = engine({ rawDays: 3 })
		await reading.maintain({ budgetMs: 120_000 })
		expect(await store.oldestHit('gone')).toBeNull()
		expect(await store.scopes()).not.toContain('gone')
		expect(await state.scopes()).toContain('gone')
		clock.at = NOON.getTime()
		const read = (scope?: string) =>
			reading.read({
				...(scope === undefined ? {} : { scope }),
				metrics: ['pageviews'],
				dateRange: days(20260901, 20260901),
			})
		expect((await read('gone')).totals).toEqual({ pageviews: 1 })
		expect((await read()).totals).toEqual({ pageviews: 1 })
		await reading.idle()
	})
})
