import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'

const DAY_MS = 86_400_000
const ANCHOR = new Date('2026-06-10T12:00:00.000Z')

const pageview = (daysAgo: number, visitor: string): StoredEvent => ({
	timestamp: new Date(ANCHOR.getTime() - daysAgo * DAY_MS),
	type: 'pageview',
	path: '/p',
	hostname: 'h',
	visitorHash: visitor,
	sessionId: `${visitor}-s`,
	durationMs: 1000,
})

describeForDb('native time-series query', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
		await flushBatch(booted.payload, [
			pageview(2, 'a'),
			pageview(2, 'b'),
			pageview(1, 'a'),
			pageview(0, 'c'),
		])
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('returns one ascending row per UTC day when granularity is day', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews', 'visitors'],
				granularity: 'day',
				dateRange: { start: new Date('2026-06-01T00:00:00.000Z'), end: ANCHOR },
			},
			{}
		)
		const series = result.rows.map((r) => ({ day: r.timestamp, pageviews: r.metrics.pageviews }))
		expect(series).toEqual([
			{ day: '2026-06-08T00:00:00.000Z', pageviews: 2 },
			{ day: '2026-06-09T00:00:00.000Z', pageviews: 1 },
			{ day: '2026-06-10T00:00:00.000Z', pageviews: 1 },
		])
		expect(result.totals?.pageviews).toBe(4)
	})
})
