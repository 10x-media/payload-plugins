import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { HOUR_MS } from '../../src/timeframe/tz'
import { ingestRequest } from './ingestRequest'
import { aroundNow, countHits, nativeOf, storedHits } from './nativeHelpers'

const AVERAGES = [
	'pageviews',
	'visitors',
	'sessions',
	'events',
	'avgDuration',
	'scrollDepth',
] as const

describeForDb('native engagement', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	const ingest = (body: Record<string, unknown>) =>
		makeIngestHandler({ geoResolver: platformHeaderResolver, target: nativeOf })(
			ingestRequest(booted.payload, body, { 'x-vercel-ip-country': 'US' })
		)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		// A tracker of today: the pageview says scroll is measured, two engagements follow it.
		await ingest({ type: 'pageview', path: '/engaged', scrollDepth: 0 })
		await ingest({ type: 'engagement', path: '/engaged', durationMs: 4000, scrollDepth: 40 })
		await ingest({ type: 'engagement', path: '/engaged', durationMs: 2000, scrollDepth: 20 })
		// A cached tracker from before engagement existed: its pageview carries its own duration.
		await ingest({ type: 'pageview', path: '/engaged', durationMs: 9000 })
		// Time that reached a page whose pageview is outside the read, and one with nothing in it.
		await ingest({ type: 'engagement', path: '/engaged-orphan', durationMs: 5000 })
		await ingest({ type: 'engagement', path: '/engaged-empty', durationMs: 'soon' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores each engagement as a row of its own, and none that carries nothing', async () => {
		const stored = (path: string) =>
			countHits(booted.payload, { path: { equals: path }, type: { equals: 'engagement' } })
		expect(await stored('/engaged')).toBe(2)
		expect(await stored('/engaged-empty')).toBe(0)
	})

	it('reads the same averages for one page as a filtered read of it', async () => {
		const expected = {
			pageviews: 2,
			visitors: 1,
			sessions: 1,
			events: 0,
			// (4000 + 2000 + the cached tracker's 9000) over two pageviews.
			avgDuration: 7500,
			// (0 + 40 + 20) over the one pageview that measured scroll.
			scrollDepth: 60,
		}
		const page = await adapter.query(
			{ metrics: [...AVERAGES], path: '/engaged', dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		const raw = await adapter.query(
			{
				metrics: [...AVERAGES],
				dateRange: aroundNow(),
				filters: [{ dimension: 'page', operator: 'eq', value: '/engaged' }],
			},
			{ payload: booted.payload }
		)
		expect(page.totals).toEqual(expected)
		expect(raw.totals).toEqual(expected)
	})

	it('leaves engagement out of a raw read of counts alone', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				dateRange: aroundNow(),
				filters: [{ dimension: 'page', operator: 'contains', value: '/engaged' }],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ pageviews: 2, visitors: 1 })
	})

	it('makes no breakdown row out of time that reached a page with no pageview', async () => {
		const whole = await adapter.query(
			{ metrics: ['pageviews', 'avgDuration'], dimensions: ['page'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		const raw = await adapter.query(
			{
				metrics: ['pageviews', 'avgDuration'],
				dimensions: ['page'],
				dateRange: aroundNow(),
				filters: [{ dimension: 'page', operator: 'contains', value: '/engaged' }],
			},
			{ payload: booted.payload }
		)
		for (const result of [whole, raw]) {
			const pages = result.rows.map((row) => row.dimensions?.page)
			expect(pages).toContain('/engaged')
			expect(pages).not.toContain('/engaged-orphan')
		}
	})

	it("files an engagement at its pageview's start, which is the day it is counted on", async () => {
		const sinceMs = 23 * HOUR_MS
		const before = Date.now()
		await ingest({ type: 'engagement', path: '/dated', durationMs: 3000, sinceMs })
		const after = Date.now()
		const rows = await storedHits(booted.payload, { path: { equals: '/dated' } })
		expect(rows).toHaveLength(1)
		const filed = new Date(String(rows[0]?.ts)).getTime()
		expect(filed).toBeGreaterThanOrEqual(before - sinceMs)
		expect(filed).toBeLessThanOrEqual(after - sinceMs)
		const lastAt = new Date(String(rows[0]?.lastAt)).getTime()
		expect(lastAt).toBeGreaterThanOrEqual(before)
		expect(lastAt).toBeLessThanOrEqual(after)
		const { store } = nativeOf(booted.payload)
		const durationOn = async (instant: number): Promise<number> => {
			const day = calendarDayOf(new Date(instant), 'UTC')
			const [row] = await store.readRaw({
				start: calendarDayStart(day, 'UTC'),
				end: calendarDayStart(addCalendarDays(day, 1), 'UTC'),
				filters: [{ dimension: 'page', operator: 'eq', value: '/dated' }],
				sessions: false,
				timeoutMs: 10_000,
			})
			return row?.parts.durationMs ?? 0
		}
		expect(await durationOn(filed)).toBe(3000)
		if (calendarDayOf(new Date(filed), 'UTC') !== calendarDayOf(new Date(after), 'UTC')) {
			expect(await durationOn(after)).toBe(0)
		}
	})

	it('files an engagement claiming a start it cannot have had when it arrives', async () => {
		const before = Date.now()
		await ingest({
			type: 'engagement',
			path: '/undated',
			durationMs: 3000,
			sinceMs: -HOUR_MS,
		})
		await ingest({
			type: 'engagement',
			path: '/undated',
			durationMs: 3000,
			sinceMs: 25 * HOUR_MS,
		})
		const rows = await storedHits(booted.payload, { path: { equals: '/undated' } })
		expect(rows).toHaveLength(2)
		for (const doc of rows) {
			expect(new Date(String(doc.ts)).getTime()).toBeGreaterThanOrEqual(before)
		}
	})

	it('counts no engagement as a pageview or an active visitor right now', async () => {
		const now = new Date()
		const result = await adapter.realtime?.(
			{
				metrics: ['visitors', 'pageviews'],
				path: '/engaged-orphan',
				dateRange: { start: new Date(now.getTime() - 10 * 60_000), end: now },
			},
			{ payload: booted.payload }
		)
		expect(result?.totals).toEqual({ visitors: 0, pageviews: 0 })
	})
})
