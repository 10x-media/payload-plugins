import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { sqliteTestAdapter } from '@10x-media/payload-test-harness/db/sqlite'
import { type CollectionConfig, createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DimensionKey, MetricKey, MetricValues } from '../../src/core/contract'
import { AnalyticsTrackError } from '../../src/core/serverEvent'
import { GOALS_SLUG } from '../../src/goals/collection'
import { purchase } from '../../src/goals/serverRevenue'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime } from '../../src/plugin/runtime'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { countHits, nativeOf, pageviewHit, storedHits } from './nativeHelpers'

const HOST = 'shop.example'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'

const configGoals: Goal[] = [
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
	{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup_done' } },
]

const metrics: MetricKey[] = ['pageviews', 'visitors', 'events', 'conversions', 'revenue']

/** What every requested metric reads as when nothing at all was recorded for the bucket. */
const NOTHING: Partial<Record<MetricKey, number>> = {
	pageviews: 0,
	visitors: 0,
	events: 0,
	conversions: 0,
	revenue: 0,
}

describeForDb('analytics server track: unscoped', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (path: string): Promise<MetricValues> => {
		const result = await adapter.query(
			{ path, metrics, dateRange: range },
			{ payload: booted.payload }
		)
		return result.totals ?? {}
	}

	/** Pageviews per value of one dimension, for one path: order-independent across tests. */
	const breakdown = async (
		path: string,
		dimension: DimensionKey
	): Promise<Record<string, number>> => {
		const result = await adapter.query(
			{ path, metrics: ['pageviews'], dimensions: [dimension], dateRange: range },
			{ payload: booted.payload }
		)
		return Object.fromEntries(
			result.rows.map((row) => [String(row.dimensions?.[dimension]), row.metrics.pageviews ?? 0])
		)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: configGoals },
				trustedPlatform: 'vercel',
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('completes a goal from a script with no request behind it', async () => {
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			hostname: HOST,
			value: 99,
			currency: 'EUR',
		})
		expect(await totalsFor('/checkout')).toMatchObject({ conversions: 1, revenue: 99 })
	})

	// Code that names no address and no agent names no visitor: its hits count, and nobody.
	it('counts no visitor for server events that come with none', async () => {
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/server', hostname: HOST })
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/server', hostname: HOST })
		expect(await totalsFor('/server')).toMatchObject({ pageviews: 2, visitors: 0 })
	})

	it('counts one visitor for repeated server events of one agent on the same day', async () => {
		const event = { path: '/server-agent', hostname: HOST, userAgent: 'billing-worker/2.0' }
		await trackServerEvent(booted.payload, { ...event, type: 'pageview' })
		await trackServerEvent(booted.payload, { ...event, type: 'pageview' })
		expect(await totalsFor('/server-agent')).toMatchObject({ pageviews: 2, visitors: 1 })
	})

	it('records an event through runtime.track', async () => {
		await getRuntime(booted.payload)?.track?.({
			type: 'event',
			name: 'signup_done',
			path: '/welcome',
			hostname: HOST,
		})
		expect(await totalsFor('/welcome')).toMatchObject({ events: 1, conversions: 1 })
	})

	it('attributes geo and device from the request it is given, and abstains without one', async () => {
		await trackServerEvent(booted.payload, {
			type: 'pageview',
			path: '/no-request',
			hostname: HOST,
		})
		// A script event carries no user agent, so it lands in no device bucket at all.
		expect(await breakdown('/no-request', 'device')).toEqual({})
		const req = {
			payload: booted.payload,
			headers: new Headers({ 'x-vercel-ip-country': 'US', 'user-agent': IPHONE_UA }),
		} as unknown as PayloadRequest
		await trackServerEvent(
			booted.payload,
			{ type: 'pageview', path: '/from-browser', hostname: HOST },
			{ req }
		)
		expect(await breakdown('/from-browser', 'device')).toEqual({ mobile: 1 })
		expect(await breakdown('/from-browser', 'country')).toEqual({ US: 1 })
	})

	it(`records the events of a request as no visitor's under identity 'none', on ${db}`, async () => {
		const req = {
			payload: booted.payload,
			headers: new Headers({
				'x-vercel-ip-country': 'US',
				'x-real-ip': '9.9.9.9',
				'user-agent': IPHONE_UA,
				'accept-language': 'de-DE,de;q=0.9',
			}),
		} as unknown as PayloadRequest
		await trackServerEvent(
			booted.payload,
			{ type: 'pageview', path: '/unmeasured', hostname: HOST },
			{ req, identity: 'none' }
		)
		await purchase(
			booted.payload,
			{ orderId: 'ord-unmeasured', value: 30, path: '/unmeasured', hostname: HOST },
			{ req, identity: 'none', flush: true }
		)
		expect(await totalsFor('/unmeasured')).toMatchObject({
			pageviews: 1,
			visitors: 0,
			conversions: 1,
			revenue: 30,
		})
		expect(await breakdown('/unmeasured', 'country')).toEqual({})
		expect(await breakdown('/unmeasured', 'device')).toEqual({})
		const docs = await storedHits(booted.payload, { path: { equals: '/unmeasured' } })
		expect(docs).toHaveLength(2)
		for (const doc of docs) {
			expect(doc.v).toBe('')
			expect(doc.country ?? '').toBe('')
			expect(doc.language ?? '').toBe('')
			expect(doc.device ?? '').toBe('')
		}
	})

	it('refuses an invalid event instead of writing a broken one', async () => {
		await expect(
			trackServerEvent(booted.payload, {
				type: 'goal',
				path: '/nameless',
				hostname: HOST,
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(await totalsFor('/nameless')).toEqual(NOTHING)
	})

	it('stores the lines of a sale on its row, idempotent or not', async () => {
		const lines = [{ id: 'sku-1', name: 'Mug', quantity: 2, price: 12 }]
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'purchase',
			path: '/sale-lines',
			hostname: HOST,
			value: 24,
			items: lines,
		})
		await purchase(booted.payload, {
			orderId: 'ord-lines',
			value: 24,
			path: '/sale-lines-order',
			hostname: HOST,
			items: lines,
		})
		for (const path of ['/sale-lines', '/sale-lines-order']) {
			const docs = await storedHits(booted.payload, { path: { equals: path } })
			expect(docs, path).toHaveLength(1)
			expect(docs[0]?.props, path).toMatchObject({ items: lines })
		}
	})

	it(`reopens the closed day a backdated sale lands on, so it is counted, on ${db}`, async () => {
		const { engine, state, store } = nativeOf(booted.payload)
		const day = addCalendarDays(calendarDayOf(new Date(), 'UTC'), -3)
		const noon = new Date(calendarDayStart(day, 'UTC').getTime() + DAY_MS / 2)
		await store.append([pageviewHit({ ts: noon, v: 'backdated-0001', path: '/backdated' })])
		expect(await engine.aggregate({ scope: '', day, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		const read = async () =>
			(
				await adapter.query(
					{
						metrics: ['pageviews', 'revenue'],
						dateRange: {
							start: calendarDayStart(day, 'UTC'),
							end: new Date(calendarDayStart(addCalendarDays(day, 1), 'UTC').getTime() - 1),
						},
					},
					{ payload: booted.payload }
				)
			).totals
		expect(await read()).toEqual({ pageviews: 1, revenue: 0 })
		await purchase(booted.payload, {
			orderId: 'ord-backdated',
			value: 40,
			hostname: HOST,
			timestamp: new Date(noon.getTime() + 3_600_000),
		})
		expect((await state.markers('', day, day))[0]?.status).toBe('dirty')
		await engine.maintain({ budgetMs: 120_000 })
		expect(await read()).toEqual({ pageviews: 1, revenue: 40 })
	})

	it(`refuses a sale dated at or before the raw floor day, or ahead of the clock, on ${db}`, async () => {
		const before = await countHits(booted.payload)
		await expect(
			purchase(booted.payload, {
				orderId: 'ord-ancient',
				value: 5,
				hostname: HOST,
				timestamp: new Date(Date.now() - 120 * DAY_MS),
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		await expect(
			purchase(booted.payload, {
				orderId: 'ord-future',
				value: 5,
				hostname: HOST,
				timestamp: new Date(Date.now() + 3_600_000),
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		expect(await countHits(booted.payload)).toBe(before)
	})
})

describeForDb('analytics server track: scoped', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (path: string, scope: string): Promise<MetricValues> => {
		const result = await adapter.query(
			{ path, scope, metrics, dateRange: range },
			{ payload: booted.payload }
		)
		return result.totals ?? {}
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				goals: { collection: true },
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stamps an explicit scope and keeps it out of every other scope', async () => {
		await trackServerEvent(booted.payload, {
			type: 'pageview',
			path: '/alpha-only',
			hostname: HOST,
			scope: 'alpha',
		})
		expect(await totalsFor('/alpha-only', 'alpha')).toMatchObject({ pageviews: 1 })
		expect(await totalsFor('/alpha-only', 'beta')).toEqual(NOTHING)
	})

	it('matches a collection goal belonging to the event’s scope', async () => {
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Invoice paid',
				slug: 'invoice-paid',
				match: { kind: 'goal' },
				scope: 'alpha',
			} as never,
		})
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'invoice-paid',
			path: '/billing',
			hostname: HOST,
			value: 12,
			scope: 'alpha',
		})
		expect(await totalsFor('/billing', 'alpha')).toMatchObject({ conversions: 1, revenue: 12 })
		// The same goal event under another scope completes nothing: goals resolve per scope.
		await trackServerEvent(booted.payload, {
			type: 'goal',
			name: 'invoice-paid',
			path: '/billing',
			hostname: HOST,
			value: 12,
			scope: 'beta',
		})
		expect(await totalsFor('/billing', 'beta')).toMatchObject({ conversions: 0, revenue: 0 })
	})

	it('resolves the scope from a request when the caller has one', async () => {
		const req = {
			payload: booted.payload,
			headers: new Headers({ 'x-tenant': 'beta' }),
		} as unknown as PayloadRequest
		await trackServerEvent(
			booted.payload,
			{ type: 'pageview', path: '/from-req', hostname: HOST },
			{ req }
		)
		expect(await totalsFor('/from-req', 'beta')).toMatchObject({ pageviews: 1 })
		expect(await totalsFor('/from-req', 'alpha')).toEqual(NOTHING)
	})
})

const ORDERS = 'track-orders'

/** A collection the host writes inside its own transaction, beside the hit it records. */
const orders: CollectionConfig = {
	slug: ORDERS,
	fields: [{ name: 'total', type: 'number' }],
}

// The hit is stored outside the host's transaction, so a rolled-back sale keeps its server hit.
// On SQLite the host holds the one writer, so the call resolves at once and stores the hit later.
describeForDb('analytics server track: inside a host transaction', {}, (db) => {
	const plugin = () =>
		analytics({
			adapters: [native()],
			capture: { gate: 'off' },
			goals: { defaults: configGoals },
		})
	let booted: BootedPayload
	let transactional: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin(), collections: [orders] })
		// Payload's SQLite adapter opens no transaction unless transactionOptions is set.
		transactional =
			db === 'sqlite'
				? await bootPayload({
						db,
						attachTo: booted,
						plugin: plugin(),
						collections: [orders],
						configOverrides: {
							db: sqliteTestAdapter(booted.connectionString, { transactionOptions: {} }),
						},
					})
				: booted
	}, 240_000)

	afterAll(async () => {
		if (transactional !== booted) {
			await transactional?.stop()
		}
		await booted?.stop()
	})

	it(`keeps the server hit of a sale the host rolls back on ${db}`, async () => {
		const { payload } = transactional
		const transactionID = await payload.db.beginTransaction()
		expect(transactionID).toBeTruthy()
		const req = await createLocalReq({}, payload)
		req.transactionID = transactionID ?? undefined
		await payload.create({ collection: ORDERS, data: { total: 5 }, req })
		const started = Date.now()
		await trackServerEvent(
			payload,
			{ type: 'goal', name: 'purchase', path: '/rolled-back', hostname: HOST, value: 5 },
			{ req, flush: true }
		)
		// Waiting on the host's own lock would hold this call for the whole busy timeout.
		expect(Date.now() - started).toBeLessThan(4_000)
		if (transactionID) {
			await payload.db.rollbackTransaction(transactionID)
		}
		await nativeOf(payload).writer.flush()

		expect((await payload.count({ collection: ORDERS })).totalDocs).toBe(0)
		expect(await countHits(payload, { path: { equals: '/rolled-back' } })).toBe(1)
		const [hit] = await storedHits(payload, { path: { equals: '/rolled-back' } })
		expect(hit).toMatchObject({ server: true, conversions: 1, revenue: 5 })
	})

	it(`stores the hit of a sale the host commits on ${db}`, async () => {
		const { payload } = transactional
		const transactionID = await payload.db.beginTransaction()
		const req = await createLocalReq({}, payload)
		req.transactionID = transactionID ?? undefined
		await payload.create({ collection: ORDERS, data: { total: 7 }, req })
		await trackServerEvent(
			payload,
			{ type: 'goal', name: 'purchase', path: '/committed', hostname: HOST, value: 7 },
			{ req }
		)
		if (transactionID) {
			await payload.db.commitTransaction(transactionID)
		}
		await nativeOf(payload).writer.flush()

		expect((await payload.count({ collection: ORDERS })).totalDocs).toBe(1)
		expect(await countHits(payload, { path: { equals: '/committed' } })).toBe(1)
	})
})
