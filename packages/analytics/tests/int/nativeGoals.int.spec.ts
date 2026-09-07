import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'
import { ingestRequest } from './ingestRequest'

const DAY_MS = 86_400_000

const goals: Goal[] = [
	{ slug: 'thanks', name: 'Thank you page', match: { kind: 'path', pattern: '/thank-you' } },
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' }, currency: 'EUR' },
	{
		slug: 'newsletter',
		name: 'Newsletter',
		match: { kind: 'event', name: 'newsletter_signup' },
		value: { fixed: 2 },
	},
]

describeForDb('native goals: config goals through ingest to reads', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const ingest = async (body: Record<string, unknown>): Promise<void> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('ingest endpoint not registered')
		}
		const res = await endpoint.handler(ingestRequest(booted.payload, { hostname: 'h', ...body }))
		expect(res.status).toBe(202)
	}

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter], goals }), db })
		// One pageview completing a path goal and carrying a scroll depth, one that carries
		// neither, one explicit goal event with revenue, one custom event completing a goal.
		await ingest({ type: 'pageview', path: '/thank-you', scrollDepth: 80, durationMs: 1000 })
		await ingest({ type: 'pageview', path: '/pricing', durationMs: 1000 })
		await ingest({
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			value: 25.5,
			currency: 'EUR',
		})
		await ingest({ type: 'event', name: 'newsletter_signup', path: '/pricing' })
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores the goal event with its value, currency, and matched goals', async () => {
		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/checkout' } } as never,
			pagination: false,
			overrideAccess: true,
		})
		const event = docs[0] as unknown as {
			type: string
			value: number
			currency: string
			goals: Array<{ slug: string; value: number }>
		}
		expect(event.type).toBe('goal')
		expect(event.value).toBe(25.5)
		expect(event.currency).toBe('EUR')
		expect(event.goals).toEqual([{ slug: 'purchase', value: 25.5 }])
	})

	it('reports conversions and revenue site-wide from rollups', async () => {
		const result = await adapter.query(
			{ metrics: ['conversions', 'revenue'], dateRange: range },
			{}
		)
		// 25.5 from the purchase event plus the newsletter goal's fixed 2.
		expect(result.totals).toEqual({ conversions: 3, revenue: 27.5 })
	})

	it('reports conversions per page', async () => {
		const result = await adapter.query(
			{ metrics: ['conversions'], dateRange: range, path: '/thank-you' },
			{}
		)
		expect(result.totals).toEqual({ conversions: 1 })
	})

	it('breaks conversions and revenue down by goal', async () => {
		const result = await adapter.query(
			{ metrics: ['conversions', 'revenue'], dimensions: ['goal'], dateRange: range },
			{}
		)
		const byGoal = Object.fromEntries(result.rows.map((r) => [r.dimensions?.goal, r.metrics]))
		expect(byGoal).toEqual({
			thanks: { conversions: 1, revenue: 0 },
			purchase: { conversions: 1, revenue: 25.5 },
			newsletter: { conversions: 1, revenue: 2 },
		})
	})

	it('averages scrollDepth over the pageviews that reported one', async () => {
		const result = await adapter.query({ metrics: ['scrollDepth'], dateRange: range }, {})
		// One pageview reported 80 and the other reported nothing: 80, not 40 (both pageviews)
		// and not 20 (all four events).
		expect(result.totals).toEqual({ scrollDepth: 80 })
	})

	it('keeps a goal slug out of the event-name breakdown', async () => {
		const result = await adapter.query(
			{ metrics: ['events'], dimensions: ['event'], dateRange: range },
			{}
		)
		expect(result.rows.map((r) => r.dimensions?.event)).toEqual(['newsletter_signup'])
	})

	it('serves the same numbers from the raw-event path as from the rollups', async () => {
		const rollups = await adapter.query(
			{ metrics: ['conversions', 'revenue', 'scrollDepth'], dateRange: range },
			{}
		)
		// granularity 'hour' bypasses the rollups and aggregates raw events instead.
		const events = await adapter.query(
			{ metrics: ['conversions', 'revenue', 'scrollDepth'], dateRange: range, granularity: 'hour' },
			{}
		)
		expect(events.totals).toEqual(rollups.totals)
		expect(events.totals).toEqual({ conversions: 3, revenue: 27.5, scrollDepth: 80 })
	})

	it('serves the goal breakdown from the raw-event path too', async () => {
		const result = await adapter.query(
			{
				metrics: ['conversions', 'revenue'],
				dimensions: ['goal'],
				dateRange: range,
				filters: [{ dimension: 'page', operator: 'contains', value: '/' }],
			},
			{}
		)
		const byGoal = Object.fromEntries(result.rows.map((r) => [r.dimensions?.goal, r.metrics]))
		expect(byGoal).toEqual({
			thanks: { conversions: 1, revenue: 0 },
			purchase: { conversions: 1, revenue: 25.5 },
			newsletter: { conversions: 1, revenue: 2 },
		})
	})

	it('advertises the grown metric and dimension contract', () => {
		for (const metric of ['conversions', 'revenue', 'scrollDepth'] as const) {
			expect(adapter.capabilities.metrics.has(metric)).toBe(true)
		}
		expect(adapter.capabilities.dimensions.has('goal')).toBe(true)
	})
})
