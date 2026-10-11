import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { toHit } from '../../src/native/engine/toHit'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { DAY_MS } from '../../src/timeframe/tz'
import { readForWidgetSeries } from '../../src/widgets/readForWidgetSeries'
import { nativeOf } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const ANCHOR = new Date('2026-06-10T12:00:00.000Z')

const pageview = (daysAgo: number, visitor: string): NormalizedEvent => ({
	timestamp: new Date(ANCHOR.getTime() - daysAgo * DAY_MS),
	type: 'pageview',
	path: '/p',
	hostname: 'h',
	visitorId: visitor,
	durationMs: 1000,
})

describeForDb('native time-series query', {}, (db) => {
	// Every raw hit read, however old: the fixture's days are further back than the default 90.
	const adapter = native({ retention: { rawDays: null } })
	let booted: BootedPayload

	const store = (events: NormalizedEvent[]) =>
		nativeOf(booted.payload).store.append(
			events.map((event) => toHit(event, { receivedAt: event.timestamp }))
		)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		await store([pageview(2, 'a'), pageview(2, 'b'), pageview(1, 'a'), pageview(0, 'c')])
	})

	afterAll(async () => {
		await booted.stop()
	})

	const reqOf = (): PayloadRequest => readerRequest(booted.payload)

	it('returns one ascending row per UTC day when granularity is day', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				granularity: 'day',
				dateRange: { start: new Date('2026-06-01T00:00:00.000Z'), end: ANCHOR },
			},
			{ payload: booted.payload }
		)
		const series = result.rows.map((r) => ({ day: r.timestamp, pageviews: r.metrics.pageviews }))
		expect(series).toEqual([
			{ day: '2026-06-08T00:00:00.000Z', pageviews: 2 },
			{ day: '2026-06-09T00:00:00.000Z', pageviews: 1 },
			{ day: '2026-06-10T00:00:00.000Z', pageviews: 1 },
		])
		expect(result.totals?.pageviews).toBe(4)
	})

	it('comparison: previousTotal reflects the equal-length window before the current one', async () => {
		// Seed 3 pageviews in the window before "last7days" (days 8 to 14 before ANCHOR).
		await store([pageview(8, 'prev-a'), pageview(9, 'prev-b'), pageview(10, 'prev-c')])
		const result = await readForWidgetSeries({
			req: reqOf(),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: ANCHOR,
		})
		expect(result.status).toBe('ok')
		// Current window (days 0 to 6 before ANCHOR): existing 4 pageviews.
		expect(result.total).toBe(4)
		// Previous window (days 7 to 13 before ANCHOR): 3 pageviews just seeded.
		expect(result.comparisonRange).toBeDefined()
		expect(result.previousTotal).toBe(3)
	})

	// The trend widget reads a quarter by week from the engine, which the chart only labels.
	it(`reads a quarter by week, each point a Monday and all of them the total, on ${db}`, async () => {
		const result = await readForWidgetSeries({
			req: reqOf(),
			metric: 'pageviews',
			timeframe: 'last90days',
			now: ANCHOR,
		})
		expect(result.status).toBe('ok')
		expect(result.seriesGranularity).toBe('week')
		expect(result.points.every((point) => new Date(point.date).getUTCDay() === 1)).toBe(true)
		expect(result.points.at(-1)).toEqual({ date: '2026-06-08T00:00:00.000Z', value: 4 })
		expect(result.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(result.total)
	})
})
