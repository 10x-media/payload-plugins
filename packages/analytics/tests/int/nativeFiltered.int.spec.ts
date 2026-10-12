import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { toHit } from '../../src/native/engine/toHit'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { HOUR_MS } from '../../src/timeframe/tz'
import { nativeOf } from './nativeHelpers'

const MIN_MS = 60_000
const H0 = new Date('2026-06-10T10:00:00.000Z').getTime()
const H1 = H0 + HOUR_MS
const H2 = H0 + 2 * HOUR_MS

// Spans the whole UTC day, which an unfiltered read answers from the day's aggregate rows.
const RANGE = {
	start: new Date('2026-06-10T00:00:00.000Z'),
	end: new Date('2026-06-11T00:00:00.000Z'),
}

// Three UTC hours, two paths, two devices, two event names, one visitor per hit. Appended to the
// store directly, on a past day that filtered reads take raw and the plain read aggregates.
const events: NormalizedEvent[] = [
	{
		timestamp: new Date(H0 + 5 * MIN_MS),
		type: 'pageview',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorId: 'v1',
		durationMs: 1000,
	},
	{
		timestamp: new Date(H0 + 50 * MIN_MS),
		type: 'pageview',
		path: '/blog/intro',
		hostname: 'h',
		device: 'mobile',
		visitorId: 'v3',
		durationMs: 500,
	},
	{
		timestamp: new Date(H1 + 5 * MIN_MS),
		type: 'pageview',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorId: 'v2',
		durationMs: 2000,
	},
	{
		timestamp: new Date(H1 + 30 * MIN_MS),
		type: 'event',
		name: 'signup',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorId: 'v5',
	},
	{
		timestamp: new Date(H2 + 5 * MIN_MS),
		type: 'pageview',
		path: '/blog/intro',
		hostname: 'h',
		device: 'mobile',
		visitorId: 'v4',
		durationMs: 1500,
	},
	{
		timestamp: new Date(H2 + 40 * MIN_MS),
		type: 'event',
		name: 'login',
		path: '/a',
		hostname: 'h',
		device: 'mobile',
		visitorId: 'v6',
	},
	// A second host for `hostname` to narrow away; its unique `tablet` device and non-pageview
	// type keep it out of the device, path, event-name and hourly pageview assertions.
	{
		timestamp: new Date(H1 + 40 * MIN_MS),
		type: 'event',
		name: 'ping',
		path: '/other',
		hostname: 'h2',
		device: 'tablet',
		visitorId: 'v7',
	},
]

describeForDb('native filtered reads and hour granularity', {}, (db) => {
	// Every raw hit read, however old: the fixture's day is further back than the default 90.
	const adapter = native({ retention: { rawDays: null } })
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		await nativeOf(booted.payload).store.append(
			events.map((event) => toHit(event, { receivedAt: event.timestamp }))
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('narrows pageviews and visitors exactly with an eq device filter', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				dateRange: RANGE,
				filters: [{ dimension: 'device', operator: 'eq', value: 'desktop' }],
			},
			{ payload: booted.payload }
		)
		// Desktop pageviews: /a at v1 and v2. Desktop visitors: v1, v2, plus v5 from the
		// desktop-tagged signup event (visitors count every matching event, not just pageviews).
		expect(result.totals).toEqual({ pageviews: 2, visitors: 3 })
	})

	it('matches a contains path filter', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				filters: [{ dimension: 'page', operator: 'contains', value: '/blog' }],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ pageviews: 2 })
	})

	it('counts only matching custom events with an event name filter', async () => {
		const result = await adapter.query(
			{
				metrics: ['events'],
				dateRange: RANGE,
				filters: [{ dimension: 'event', operator: 'eq', value: 'signup' }],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ events: 1 })
	})

	it('returns one row per active UTC hour with exact totals for hour granularity', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				granularity: 'hour',
			},
			{ payload: booted.payload }
		)
		expect(result.rows).toEqual([
			{ timestamp: '2026-06-10T10:00:00.000Z', metrics: { pageviews: 2 } },
			{ timestamp: '2026-06-10T11:00:00.000Z', metrics: { pageviews: 1 } },
			{ timestamp: '2026-06-10T12:00:00.000Z', metrics: { pageviews: 1 } },
		])
		expect(result.totals).toEqual({ pageviews: 4 })
	})

	it("serves an unfiltered day from its aggregate rows, matching the raw hits' totals", async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors', 'sessions', 'events', 'avgDuration'],
				dateRange: RANGE,
			},
			{ payload: booted.payload }
		)
		// Both hosts (visitor ids are per host, so rows add up): 4 pageviews, 3 custom events,
		// 7 visitors and visits (one per hit), avgDuration (1000+2000+500+1500)/4.
		expect(result.totals).toEqual({
			pageviews: 4,
			visitors: 7,
			sessions: 7,
			events: 3,
			avgDuration: 1250,
		})
	})

	it('narrows to a single path when q.path is set on a filtered read', async () => {
		// Mobile alone matches the /blog/intro pageviews (C, D) and the /a "login" event (F);
		// pinning path to /blog/intro drops F, so events falls to 0 and pageviews stay put.
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'events'],
				dateRange: RANGE,
				path: '/blog/intro',
				filters: [{ dimension: 'device', operator: 'eq', value: 'mobile' }],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ pageviews: 2, events: 0 })
	})

	it('narrows to a single host when q.hostname is set on a filtered read', async () => {
		// device: 'tablet' only exists on the second-host fixture event above.
		const combined = await adapter.query(
			{
				metrics: ['events'],
				dateRange: RANGE,
				filters: [{ dimension: 'device', operator: 'eq', value: 'tablet' }],
			},
			{ payload: booted.payload }
		)
		expect(combined.totals).toEqual({ events: 1 })

		const scopedToOtherHost = await adapter.query(
			{
				metrics: ['events'],
				dateRange: RANGE,
				hostname: 'h',
				filters: [{ dimension: 'device', operator: 'eq', value: 'tablet' }],
			},
			{ payload: booted.payload }
		)
		expect(scopedToOtherHost.totals).toEqual({ events: 0 })
	})

	it('ANDs q.path with a conflicting page filter instead of one overwriting the other', async () => {
		const conflicting = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				path: '/a',
				filters: [{ dimension: 'page', operator: 'eq', value: '/blog/intro' }],
			},
			{ payload: booted.payload }
		)
		expect(conflicting.totals).toEqual({ pageviews: 0 })

		const matching = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				path: '/a',
				filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
			},
			{ payload: booted.payload }
		)
		expect(matching.totals).toEqual({ pageviews: 2 })
	})

	it('ANDs two eq filters on the same dimension instead of one overwriting the other', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				filters: [
					{ dimension: 'page', operator: 'eq', value: '/a' },
					{ dimension: 'page', operator: 'eq', value: '/blog/intro' },
				],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ pageviews: 0 })
	})

	it('ANDs two composable contains filters on the same dimension', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				filters: [
					{ dimension: 'page', operator: 'contains', value: 'blog' },
					{ dimension: 'page', operator: 'contains', value: 'intro' },
				],
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({ pageviews: 2 })
	})
})
