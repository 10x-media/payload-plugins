import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { MetricKey, MetricValues } from '../../src/core/contract'
import { purchase, refund } from '../../src/goals/serverRevenue'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { noopResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { dedupeKeyFor, orderDigestKey } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { orderHitId } from '../../src/native/store/ids'
import { DAY_MS } from '../../src/timeframe/tz'
import { INGEST_HOST, ingestRequest } from './ingestRequest'
import { countHits, nativeOf, storedHits } from './nativeHelpers'

const metrics: MetricKey[] = ['conversions', 'revenue']

const configGoals: Goal[] = [{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }]

describeForDb('analytics revenue idempotency', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const handler = makeIngestHandler({
		geoResolver: noopResolver,
		resolvers: { goals: async () => configGoals },
		target: nativeOf,
	})

	const beacon = (body: Record<string, unknown>) =>
		handler(ingestRequest(booted.payload, { hostname: INGEST_HOST, ...body }))

	const totalsFor = async (path: string): Promise<MetricValues> =>
		(await adapter.query({ path, metrics, dateRange: range }, { payload: booted.payload }))
			.totals ?? {}

	const eventCount = (path: string): Promise<number> =>
		countHits(booted.payload, { path: { equals: path } })

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: configGoals },
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// Anyone can POST a beacon, so a forged refund would be a permanent, unauthenticated
	// subtraction from revenue.
	it('refuses a forged revenue flag and negative value, storing nothing', async () => {
		const flagged = await beacon({
			type: 'goal',
			name: 'purchase',
			path: '/forged',
			revenue: true,
			value: -5000,
			orderId: 'forged_1',
		})
		const negative = await beacon({
			type: 'goal',
			name: 'purchase',
			path: '/forged',
			value: -5000,
		})

		expect(flagged.status).toBe(400)
		expect(negative.status).toBe(400)
		expect(await totalsFor('/forged')).toMatchObject({ conversions: 0, revenue: 0 })
		expect(await eventCount('/forged')).toBe(0)
	})

	// The sale happened: a refund takes its money back and leaves its conversion standing.
	it('records a refund from the server call, which is the one path that may', async () => {
		await purchase(booted.payload, { value: 80, orderId: 'ord_ref', path: '/refunded' })
		await refund(booted.payload, {
			value: 80,
			orderId: 'ord_ref',
			refundId: 're_ref',
			path: '/refunded',
		})

		expect(await totalsFor('/refunded')).toMatchObject({ conversions: 1, revenue: 0 })
	})

	// A visitor who guesses an order id could otherwise pre-register it on the wire and make
	// the payment webhook's own write look like a duplicate, losing the sale for good.
	it('never lets a browser record block the server record of the same order', async () => {
		const posted = await beacon({
			type: 'goal',
			name: 'purchase',
			path: '/preempt',
			value: 1,
			orderId: 'ord_pre',
		})
		await purchase(booted.payload, { value: 250, orderId: 'ord_pre', path: '/preempt' })

		expect(posted.status).toBe(202)
		expect(await eventCount('/preempt')).toBe(2)
		expect(await totalsFor('/preempt')).toMatchObject({ conversions: 1, revenue: 250 })
	})

	it('counts a browser sale on its own while the server never records it', async () => {
		await beacon({
			type: 'goal',
			name: 'purchase',
			path: '/browser-only',
			value: 9,
			orderId: 'ord_b',
		})
		await beacon({
			type: 'goal',
			name: 'purchase',
			path: '/browser-only',
			value: 9,
			orderId: 'ord_b',
		})

		expect(await eventCount('/browser-only')).toBe(1)
		expect(await totalsFor('/browser-only')).toMatchObject({ conversions: 1, revenue: 9 })
	})

	it('records the same order once however often the webhook retries', async () => {
		await purchase(booted.payload, { value: 42, orderId: 'ord_retry', path: '/retried' })
		await purchase(booted.payload, { value: 42, orderId: 'ord_retry', path: '/retried' })
		await purchase(booted.payload, { value: 42, orderId: 'ord_retry', path: '/retried' })

		expect(await totalsFor('/retried')).toMatchObject({ conversions: 1, revenue: 42 })
		expect(await eventCount('/retried')).toBe(1)
	})

	// Joined with ':', `goal:"a", orderId:"b:c"` and `goal:"a:b", orderId:"c"` would share one key,
	// and one order would swallow the other.
	it('keeps two orders apart when a join would have made their keys equal', async () => {
		await purchase(booted.payload, {
			value: 10,
			goal: 'purchase',
			orderId: 'a:b',
			path: '/amb',
		})
		await purchase(booted.payload, {
			value: 10,
			goal: 'purchase:a',
			orderId: 'b',
			path: '/amb',
		})

		expect(await eventCount('/amb')).toBe(2)
	})

	// One INSERT is the whole record of an order, keyed by its dedupe key: an attempt that stored
	// it and then failed to answer left nothing half done, and every retry meets that key.
	it('counts an order an earlier attempt stored once, whatever its retries carry', async () => {
		await purchase(booted.payload, { value: 17, orderId: 'ord_half', path: '/half' })
		await purchase(booted.payload, { value: 99, orderId: 'ord_half', path: '/half' })

		expect(await eventCount('/half')).toBe(1)
		expect(await totalsFor('/half')).toMatchObject({ conversions: 1, revenue: 17 })
		const [hit] = await storedHits(booted.payload, { path: { equals: '/half' } })
		expect(hit?.id).toBe(
			orderHitId(
				dedupeKeyFor({
					origin: 'server',
					goal: 'purchase',
					orderId: 'ord_half',
					key: orderDigestKey(booted.payload.secret),
				})
			)
		)
	})

	it('records an order once when its retries race each other', async () => {
		await Promise.all(
			Array.from({ length: 8 }, () =>
				purchase(booted.payload, { value: 30, orderId: 'ord_race', path: '/raced' })
			)
		)

		expect(await eventCount('/raced')).toBe(1)
		expect(await totalsFor('/raced')).toMatchObject({ conversions: 1, revenue: 30 })
	})
})
