import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { AGGREGATES_SLUG, STATE_SLUG } from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { DAY_LEASE_MS, dayKey } from '../../src/native/store/state'
import { MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { countHits, nativeOf, pageviewHit } from './nativeHelpers'

const MINUTE = 60_000
/** Noon UTC on 20261007: 20261006 is closed but provisional, every day before it sealed. */
const NOW = new Date('2026-10-07T12:00:00.000Z')
const TODAY = 20261007

/** Days relative to today, each holding the hits the spec counts, pruning and keeping. */
const D12 = 20260925
const D9 = 20260928
const D8 = 20260929
const D2 = 20261005
const D1 = 20261006

const at = (day: CalendarDay, minutes: number): Date =>
	new Date(calendarDayStart(day, 'UTC').getTime() + minutes * MINUTE)

const hitsOn = (payload: Payload, day: CalendarDay) =>
	countHits(payload, {
		and: [
			{ ts: { greater_than_equal: calendarDayStart(day, 'UTC').toISOString() } },
			{ ts: { less_than: calendarDayStart(addCalendarDays(day, 1), 'UTC').toISOString() } },
		],
	})

/** The whole of one UTC day, as a read asks for it. */
const wholeDay = (day: CalendarDay) => ({
	start: calendarDayStart(day, 'UTC'),
	end: new Date(calendarDayStart(addCalendarDays(day, 1), 'UTC').getTime() - 1),
})

/** The generation of each of a day's aggregate rows. */
const gensOn = async (payload: Payload, day: CalendarDay): Promise<unknown[]> =>
	(
		await payload.db.find({
			collection: AGGREGATES_SLUG,
			where: { and: [{ scope: { equals: '' } }, { day: { equals: day } }] },
			pagination: false,
			req: {},
		})
	).docs.map((doc) => Reflect.get(doc, 'gen'))

const saltRows = async (payload: Payload): Promise<number> =>
	(
		await payload.db.count({
			collection: STATE_SLUG,
			where: { kind: { equals: 'salt' } },
			req: {},
		})
	).totalDocs

describeForDb('native maintenance', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	const engineOf = () => nativeOf(booted.payload)

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ retention: { rawDays: 3, aggregateDays: 10 } })],
				capture: { gate: 'off' },
			}),
		})
		const { store, state } = engineOf()
		await store.append([
			pageviewHit({ ts: at(D12, 60), v: 'visitor-d12-0001' }),
			pageviewHit({ ts: at(D12, 90), v: 'visitor-d12-0002' }),
			pageviewHit({ ts: at(D9, 60), v: 'visitor-d9-00001' }),
			pageviewHit({ ts: at(D8, 60), v: 'visitor-d8-00001' }),
			pageviewHit({ ts: at(D2, 60), v: 'visitor-d2-00001' }),
			pageviewHit({ ts: at(D1, 60), v: 'visitor-d1-00001' }),
			pageviewHit({ ts: at(TODAY, 60), v: 'visitor-today-01' }),
		])
		// Another process is counting D8, so it stays open: neither its hits nor anything after
		// the start of it may be pruned.
		await state.ensureMarkers([{ scope: '', day: D8, tz: 'UTC' }])
		expect(await state.claim(dayKey('', D8), 'elsewhere', DAY_LEASE_MS)).toBe(true)
		await state.salt(20261001)
		await state.salt(TODAY)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	it(`counts closed days, finalizes the sealed ones, sweeps old salts and beats on ${db}`, async () => {
		const report = await engineOf().engine.maintain({ budgetMs: 120_000, heartbeat: true })
		expect(report).toMatchObject({ ran: true, finished: true, failed: 0, aggregated: 4 })
		expect(report.sweptSalts).toBe(1)
		const markers = await engineOf().state.markers('', D9, TODAY)
		const status = new Map(markers.map((marker) => [marker.day, marker.status]))
		expect(status.get(D9)).toBe('final')
		expect(status.get(D8)).toBe('open')
		expect(status.get(D2)).toBe('final')
		expect(status.get(D1)).toBe('provisional')
		expect(status.has(TODAY)).toBe(false)
		expect(await saltRows(booted.payload)).toBe(1)
		expect(await engineOf().state.lastBeat(MAINTAIN_TASK_SLUG)).toEqual(NOW)
	})

	it(`prunes raw hits only before the oldest day not yet final, and totals past aggregateDays on ${db}`, async () => {
		expect(await hitsOn(booted.payload, D12)).toBe(0)
		expect(await hitsOn(booted.payload, D9)).toBe(0)
		expect(await hitsOn(booted.payload, D8)).toBe(1)
		expect(await hitsOn(booted.payload, D2)).toBe(1)
		expect(await hitsOn(booted.payload, D1)).toBe(1)
		expect(await hitsOn(booted.payload, TODAY)).toBe(1)
		expect(await gensOn(booted.payload, D12)).toEqual([])
		expect(await engineOf().state.markers('', D12, D12)).toEqual([])
		expect((await gensOn(booted.payload, D9)).length).toBeGreaterThan(0)
		const read = await engineOf().engine.read({ metrics: ['pageviews'], dateRange: wholeDay(D9) })
		expect(read.totals).toEqual({ pageviews: 1 })
	})

	it(`sweeps the rows a run noted it might leave on ${db}`, async () => {
		// A run notes the day before it writes beside the readable rows, and stopped there.
		await engineOf().state.noteDrop({ scope: '', day: D2, gen: 'crashed-run' })
		await booted.payload.db.create({
			collection: AGGREGATES_SLUG,
			data: {
				id: 'left-behind',
				scope: '',
				day: D2,
				hostname: 'h',
				dim: '',
				value: '',
				dim2: '',
				value2: '',
				gen: 'crashed-run',
				pageviews: 1000,
			},
			req: {},
		})
		expect((await gensOn(booted.payload, D2)).includes('crashed-run')).toBe(true)
		const report = await engineOf().engine.maintain({ budgetMs: 120_000 })
		expect(report.sweptRows).toBeGreaterThanOrEqual(1)
		expect((await gensOn(booted.payload, D2)).includes('crashed-run')).toBe(false)
		expect(await engineOf().state.drops(10)).toEqual([])
		const [total] = await engineOf().store.readAggregates({
			scope: '',
			days: [[D2, D2]],
			dim: '',
			groupBy: 'total',
		})
		expect(total?.parts.pageviews).toBe(1)
	})

	it(`does the work once when two runs start together, then prunes what it may on ${db}`, async () => {
		expect(await engineOf().state.release(dayKey('', D8), 'elsewhere')).toBe(true)
		const [one, two] = await Promise.all([
			engineOf().engine.maintain({ budgetMs: 120_000 }),
			engineOf().engine.maintain({ budgetMs: 120_000 }),
		])
		expect([one?.ran, two?.ran].sort()).toEqual([false, true])
		expect((one?.aggregated ?? 0) + (two?.aggregated ?? 0)).toBe(1)
		const [d8] = await engineOf().state.markers('', D8, D8)
		expect(d8?.status).toBe('final')
		expect(await hitsOn(booted.payload, D8)).toBe(0)
		expect(await hitsOn(booted.payload, D2)).toBe(1)
	})
})
