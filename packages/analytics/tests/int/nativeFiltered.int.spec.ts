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
		// Same values the events path would compute directly from the fixture above:
		// 4 pageviews, 2 custom events, 6 distinct visitors/sessions (one each per event),
		// avgDuration = (1000+2000+500+1500)/4 pageviews.
		expect(result.totals).toEqual({
			pageviews: 4,
			visitors: 6,
			sessions: 6,
			events: 2,
			avgDuration: 1250,
		})
	})
})
