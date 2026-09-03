import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'

const HOUR_MS = 3_600_000
const MIN_MS = 60_000
const H0 = new Date('2026-06-10T10:00:00.000Z').getTime()
const H1 = H0 + HOUR_MS
const H2 = H0 + 2 * HOUR_MS

// Spans the whole UTC day: the rollup path's period filter needs the day-floor bucket
// (00:00) inside the range, not just the fixture's 10:00-13:00 event spread.
const RANGE = {
	start: new Date('2026-06-10T00:00:00.000Z'),
	end: new Date('2026-06-11T00:00:00.000Z'),
}

// Mixed fixture across three UTC hours: two paths, two devices, two custom event
// names. Fed through flushBatch (not the ingest endpoint) so both the raw events and
// their same-day rollups exist, letting one fixture cover the events path and the
// rollup-path parity check below.
const events: StoredEvent[] = [
	{
		timestamp: new Date(H0 + 5 * MIN_MS),
		type: 'pageview',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorHash: 'v1',
		sessionId: 'v1-s1',
		durationMs: 1000,
	},
	{
		timestamp: new Date(H0 + 50 * MIN_MS),
		type: 'pageview',
		path: '/blog/intro',
		hostname: 'h',
		device: 'mobile',
		visitorHash: 'v3',
		sessionId: 'v3-s1',
		durationMs: 500,
	},
	{
		timestamp: new Date(H1 + 5 * MIN_MS),
		type: 'pageview',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorHash: 'v2',
		sessionId: 'v2-s1',
		durationMs: 2000,
	},
	{
		timestamp: new Date(H1 + 30 * MIN_MS),
		type: 'event',
		name: 'signup',
		path: '/a',
		hostname: 'h',
		device: 'desktop',
		visitorHash: 'v5',
		sessionId: 'v5-s1',
	},
	{
		timestamp: new Date(H2 + 5 * MIN_MS),
		type: 'pageview',
		path: '/blog/intro',
		hostname: 'h',
		device: 'mobile',
		visitorHash: 'v4',
		sessionId: 'v4-s1',
		durationMs: 1500,
	},
	{
		timestamp: new Date(H2 + 40 * MIN_MS),
		type: 'event',
		name: 'login',
		path: '/a',
		hostname: 'h',
		device: 'mobile',
		visitorHash: 'v6',
		sessionId: 'v6-s1',
	},
	// A second host, so q.hostname has something real to narrow away. `device: 'tablet'`
	// is otherwise unused in this fixture, which keeps it from touching the device/path/
	// event-name assertions above; it lands inside the existing H1 bucket (not a pageview,
	// so it doesn't shift the hour-granularity pageview counts either).
	{
		timestamp: new Date(H1 + 40 * MIN_MS),
		type: 'event',
		name: 'ping',
		path: '/other',
		hostname: 'h2',
		device: 'tablet',
		visitorHash: 'v7',
		sessionId: 'v7-s1',
	},
]

describeForDb('native filtered reads and hour granularity', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
		await flushBatch(booted.payload, events)
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
			{}
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
			{}
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
			{}
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
			{}
		)
		expect(result.rows).toEqual([
			{ timestamp: '2026-06-10T10:00:00.000Z', metrics: { pageviews: 2 } },
			{ timestamp: '2026-06-10T11:00:00.000Z', metrics: { pageviews: 1 } },
			{ timestamp: '2026-06-10T12:00:00.000Z', metrics: { pageviews: 1 } },
		])
		expect(result.totals).toEqual({ pageviews: 4 })
	})

	it('still serves an unfiltered day query from rollups, matching the raw-event totals', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors', 'sessions', 'events', 'avgDuration'],
				dateRange: RANGE,
			},
			{}
		)
		// Same values the events path would compute directly from the fixture above, across
		// both hosts (the hostname-less rollup family aggregates every host, same as an
		// unfiltered events-path read would): 4 pageviews, 3 custom events (signup, login,
		// ping), 7 distinct visitors/sessions (one each per event), avgDuration =
		// (1000+2000+500+1500)/4 pageviews.
		expect(result.totals).toEqual({
			pageviews: 4,
			visitors: 7,
			sessions: 7,
			events: 3,
			avgDuration: 1250,
		})
	})

	it('narrows to a single path when q.path is set on a filtered read', async () => {
		// Device "mobile" alone matches the /blog/intro pageviews (C, D) and the /a "login"
		// event (F); pinning q.path to /blog/intro excludes F, so events drops to 0 while
		// pageviews (already all /blog/intro) is untouched.
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'events'],
				dateRange: RANGE,
				path: '/blog/intro',
				filters: [{ dimension: 'device', operator: 'eq', value: 'mobile' }],
			},
			{}
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
			{}
		)
		expect(combined.totals).toEqual({ events: 1 })

		const scopedToOtherHost = await adapter.query(
			{
				metrics: ['events'],
				dateRange: RANGE,
				hostname: 'h',
				filters: [{ dimension: 'device', operator: 'eq', value: 'tablet' }],
			},
			{}
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
			{}
		)
		expect(conflicting.totals).toEqual({ pageviews: 0 })

		const matching = await adapter.query(
			{
				metrics: ['pageviews'],
				dateRange: RANGE,
				path: '/a',
				filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
			},
			{}
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
			{}
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
			{}
		)
		expect(result.totals).toEqual({ pageviews: 2 })
	})
})
