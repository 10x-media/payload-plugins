import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type {
	AnalyticsQuery,
	AnalyticsRow,
	DimensionKey,
	MetricValues,
} from '../../src/core/contract'
import { AnalyticsTrackError } from '../../src/core/serverEvent'
import { purchase, refund } from '../../src/goals/serverRevenue'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { rawAnswer } from '../../src/native/engine/rawAnswer'
import { signOrderId } from '../../src/native/ingest/orderSignature'
import { dedupeKeyFor, MAX_ORDER_ID_LENGTH, orderDigestKey } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { orderHitId, ulid } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import {
	addCalendarDays,
	type CalendarDay,
	calendarDayOf,
	calendarDayStart,
} from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { INGEST_HOST } from './ingestRequest'
import { nativeOf, postBeacon } from './nativeHelpers'

const MINUTE = 60_000
const today = (): CalendarDay => calendarDayOf(new Date(), 'UTC')
/**
 * Noon UTC on 20261007, where the raw retention specs hold Payload's clock: with three raw days,
 * 20261006 is closed and above the raw floor, which it never is in the first quarter hour of a day.
 */
const NOW = new Date('2026-10-07T12:00:00.000Z')
const TODAY: CalendarDay = 20261007
const dayStart = (day: CalendarDay): Date => calendarDayStart(day, 'UTC')
/** `minutes` after noon of a UTC day. */
const at = (day: CalendarDay, minutes = 0): Date =>
	new Date(dayStart(day).getTime() + DAY_MS / 2 + minutes * MINUTE)
const rangeOf = (first: CalendarDay, last: CalendarDay): AnalyticsQuery['dateRange'] => ({
	start: dayStart(first),
	end: new Date(dayStart(addCalendarDays(last, 1)).getTime() - 1),
})

/** The digest key every instance here shares, since they boot with one secret; set at boot. */
let orderKey: Buffer | undefined

/** The id of one record of an order: the browser's or the server's, as ingest keys it. */
const keyOf = (origin: 'wire' | 'server', scope: string, orderId: string): string =>
	orderHitId(dedupeKeyFor({ origin, tenant: scope, goal: 'purchase', orderId, key: orderKey }))

/** Browser's record of order `orderId`: a visitor from a newsletter campaign who bought for 9. */
const boughtFromCampaign = (scope: string, orderId: string, landed: Date): HitRow[] => {
	const amount = 9
	const visitor = {
		scope,
		hostname: INGEST_HOST,
		v: `${scope}-visitor`.padEnd(16, 'x'),
		country: 'DE',
		device: 'mobile',
	}
	return [
		{
			...visitor,
			id: ulid(landed),
			ts: landed,
			type: 'pageview',
			path: '/offer',
			landing: true,
			server: false,
			source: 'news',
			channel: 'email',
			utmSource: 'news',
			utmMedium: 'email',
			utmCampaign: 'fall',
		},
		{
			...visitor,
			id: keyOf('wire', scope, orderId),
			ts: new Date(landed.getTime() + 4 * MINUTE),
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			landing: false,
			server: false,
			source: 'direct',
			channel: 'direct',
			value: amount,
			currency: 'USD',
			conversions: 1,
			revenue: amount,
			goals: [{ slug: 'purchase', value: amount }],
		},
	]
}

/** What a read answers, by the value of one dimension, as conversions and revenue. */
const byOf = (rows: readonly AnalyticsRow[], dimension: DimensionKey) =>
	Object.fromEntries(
		rows.map((row) => [
			String(row.dimensions?.[dimension]),
			[row.metrics.conversions, row.metrics.revenue],
		])
	)

const serverOnly: Goal = {
	slug: 'subscription',
	name: 'Subscription',
	match: { kind: 'goal' },
	browser: false,
}

describeForDb('analytics native orders', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let item = ''

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: [serverOnly] },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				collections: { offers: { item: true, scopeField: false } },
				revenue: true,
			}),
			collections: [{ slug: 'offers', fields: [{ name: 'title', type: 'text' }] }],
		})
		const offer = await booted.payload.create({
			collection: 'offers' as never,
			data: { title: 'Annual plan' } as never,
		})
		item = `offers:${String((offer as { id: string | number }).id)}`
		orderKey = orderDigestKey(booted.payload.secret)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	const query = (scope: string, more: Partial<AnalyticsQuery>): AnalyticsQuery => ({
		scope,
		metrics: ['conversions', 'revenue'],
		timezone: 'UTC',
		dateRange: rangeOf(today(), today()),
		...more,
	})

	/** A read's totals and its breakdowns, each read the way `read` answers it. */
	const snapshotOf = async (
		read: (
			extra: Partial<AnalyticsQuery>
		) => Promise<{ rows: AnalyticsRow[]; totals?: MetricValues }>
	) => {
		const by = async (dimension: DimensionKey) =>
			byOf((await read({ dimensions: [dimension] })).rows, dimension)
		return {
			totals: (await read({})).totals,
			channel: await by('channel'),
			utmCampaign: await by('utmCampaign'),
			country: await by('country'),
			goal: await by('goal'),
			currency: await by('currency'),
			item: (await read({ item })).totals,
			itemPages: (await read({ item, dimensions: ['page'], metrics: ['impressions'] })).rows,
		}
	}

	/** A read as a report answers it, from the daily totals where a day is counted. */
	const counted = (scope: string, more: Partial<AnalyticsQuery>) =>
		snapshotOf((extra) =>
			adapter.query(query(scope, { ...more, ...extra }), { payload: booted.payload })
		)

	/** The same read answered straight from the raw hits, as the reference. */
	const fromRaw = (scope: string, more: Partial<AnalyticsQuery>) =>
		snapshotOf((extra) =>
			rawAnswer(nativeOf(booted.payload).store, query(scope, { ...more, ...extra }), {
				scope,
				tz: 'UTC',
			})
		)

	it(`credits a sale across days with the server's item, files its refund in the sale's rows, and counts it as read raw, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const scope = 'credit'
		const d1 = addCalendarDays(today(), -3)
		const d2 = addCalendarDays(today(), -2)
		await store.append(boughtFromCampaign(scope, 'A', at(d1)))
		const server = { scope, hostname: INGEST_HOST, currency: 'EUR', item }
		// Within a day of the browser's record, on the next day.
		await purchase(booted.payload, { ...server, orderId: 'A', value: 250, timestamp: at(d2, -690) })
		await refund(booted.payload, {
			...server,
			orderId: 'A',
			refundId: 're_1',
			value: 100,
			timestamp: at(d2, -630),
		})
		await purchase(booted.payload, { ...server, orderId: 'B', value: 70, timestamp: at(d2, -600) })

		const both = { dateRange: rangeOf(d1, d2) }
		const expected = {
			totals: { conversions: 2, revenue: 220 },
			channel: { email: [1, 150] },
			utmCampaign: { fall: [1, 150] },
			country: { DE: [1, 150] },
			goal: { purchase: [2, 220] },
			currency: { EUR: [2, 220] },
			item: { conversions: 2, revenue: 220 },
			itemPages: [],
		}
		expect(await fromRaw(scope, both)).toEqual(expected)
		// The background maintenance ingest started may hold a day's lease.
		await engine.idle()
		for (const day of [d1, d2]) {
			expect((await engine.aggregate({ scope, day, tz: 'UTC' })).outcome).toBe('completed')
		}
		expect(await counted(scope, both)).toEqual(expected)
		expect((await counted(scope, { dateRange: rangeOf(d1, d1) })).totals).toEqual({
			conversions: 1,
			revenue: 250,
		})
		const second = await counted(scope, { dateRange: rangeOf(d2, d2) })
		expect(second.totals).toEqual({ conversions: 1, revenue: -30 })
		expect(second.channel).toEqual({ email: [0, -100] })
		expect(await fromRaw(scope, { dateRange: rangeOf(d2, d2) })).toEqual(second)
	})

	it(`counts a webhook more than a day from the browser's record on its own, the browser's record without its sale, on ${db}`, async () => {
		const { store } = nativeOf(booted.payload)
		const scope = 'far'
		const first = addCalendarDays(today(), -3)
		await store.append(boughtFromCampaign(scope, 'F', at(first)))
		await purchase(booted.payload, {
			scope,
			hostname: INGEST_HOST,
			orderId: 'F',
			value: 250,
			timestamp: at(addCalendarDays(today(), -1)),
		})
		const range = { dateRange: rangeOf(first, today()) }
		const answer = await adapter.query(
			query(scope, { ...range, metrics: ['conversions', 'revenue', 'events'] }),
			{ payload: booted.payload }
		)
		expect(answer.totals).toEqual({ conversions: 1, revenue: 250, events: 2 })
		const byChannel = await adapter.query(query(scope, { ...range, dimensions: ['channel'] }), {
			payload: booted.payload,
		})
		expect(byOf(byChannel.rows, 'channel')).toEqual({ email: [0, 0] })
	})

	it(`drops an order id no key can be stored under from a page, refuses it from server code, and keys a Stripe session id, on ${db}`, async () => {
		const scope = 'ids'
		const sale = { type: 'goal', name: 'purchase', path: '/checkout', value: 9 }
		const send = (orderId: string) =>
			postBeacon(booted.payload, { hostname: INGEST_HOST, ...sale, orderId }, { 'x-tenant': scope })
		const refused = await send('x'.repeat(MAX_ORDER_ID_LENGTH + 1))
		// Dropped as a 202, which the totals below show counted nothing.
		expect(refused.status).toBe(202)
		await expect(
			purchase(booted.payload, {
				scope,
				hostname: INGEST_HOST,
				orderId: 'x'.repeat(MAX_ORDER_ID_LENGTH + 1),
				value: 9,
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
		const stripe = 'cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u'
		expect((await send(stripe)).status).toBe(202)
		await purchase(booted.payload, { scope, hostname: INGEST_HOST, orderId: stripe, value: 250 })
		await purchase(booted.payload, { scope, hostname: INGEST_HOST, orderId: stripe, value: 250 })
		const { store } = nativeOf(booted.payload)
		expect(await store.hitById(keyOf('wire', scope, stripe))).toMatchObject({ revenue: 9 })
		expect(await store.hitById(keyOf('server', scope, stripe))).toMatchObject({ revenue: 250 })
		const answer = await adapter.query(
			query(scope, {
				dateRange: { start: new Date(Date.now() - DAY_MS), end: new Date(Date.now() + MINUTE) },
			}),
			{ payload: booted.payload }
		)
		expect(answer.totals).toEqual({ conversions: 1, revenue: 250 })
	})

	it(`ignores a browser's completion of a server-only goal, and counts the server's, on ${db}`, async () => {
		const scope = 'server-only'
		const send = await postBeacon(
			booted.payload,
			{ hostname: INGEST_HOST, type: 'goal', name: 'subscription', path: '/x', value: 1e12 },
			{ 'x-tenant': scope }
		)
		expect(send.status).toBe(202)
		await purchase(booted.payload, {
			scope,
			hostname: INGEST_HOST,
			goal: 'subscription',
			orderId: 'inv_1',
			value: 49,
		})
		const answer = await adapter.query(
			query(scope, {
				dimensions: ['goal'],
				dateRange: { start: new Date(Date.now() - DAY_MS), end: new Date(Date.now() + MINUTE) },
			}),
			{ payload: booted.payload }
		)
		expect(byOf(answer.rows, 'goal')).toEqual({ subscription: [1, 49] })
	})

	it(`finds a hit by key, a visitor's latest landing and a window's orders, and keeps an order as its tombstone, on ${db}`, async () => {
		const { store } = nativeOf(booted.payload)
		const scope = 'store-orders'
		const day = addCalendarDays(today(), -5)
		const [landing, order] = boughtFromCampaign(scope, 'T', at(day))
		if (!landing || !order) {
			throw new Error('a campaign visit holds a landing and an order')
		}
		await store.append([
			{ ...order, item, props: { plan: 'pro' } },
			landing,
			{ ...landing, id: ulid(at(day, 30)), ts: at(day, 30), source: 'later' },
		])
		expect(await store.hitById(order.id)).toMatchObject({
			id: order.id,
			ts: order.ts,
			v: order.v,
			country: 'DE',
			item,
			props: { plan: 'pro' },
			goals: [{ slug: 'purchase', value: 9 }],
			server: false,
			landing: false,
		})
		expect(await store.hitById('os.none')).toBeNull()
		expect(
			await store.latestLanding({
				scope,
				hostname: INGEST_HOST,
				v: order.v,
				start: dayStart(day),
				end: order.ts,
			})
		).toMatchObject({ id: landing.id, source: 'news' })
		const window = { scope, start: dayStart(day), end: dayStart(addCalendarDays(day, 1)) }
		expect(await store.ordersIn({ ...window, limit: 10 })).toEqual([{ id: order.id, ts: order.ts }])

		const before = dayStart(addCalendarDays(day, 1))
		expect(await store.pruneHits({ scope, from: dayStart(day), before, limit: 10 })).toBe(3)
		expect(await store.pruneHits({ scope, before, limit: 10 })).toBe(0)
		const stone = await store.hitById(order.id)
		expect(stone).toMatchObject({
			v: '',
			item,
			revenue: 9,
			goals: [{ slug: 'purchase', value: 9 }],
		})
		for (const field of ['country', 'device', 'utmCampaign', 'source', 'props'] as const) {
			expect(stone).not.toHaveProperty(field)
		}
		expect(await store.oldestHit(scope)).toEqual(order.ts)
		expect(await store.expireOrders({ scope, before, limit: 10 })).toBe(1)
		expect(await store.oldestHit(scope)).toBeNull()
	})
})

describeForDb('analytics native orders past raw retention', {}, (db) => {
	const adapter = native({ retention: { rawDays: 3 } })
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				revenue: true,
			}),
		})
		orderKey = orderDigestKey(booted.payload.secret)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted?.stop()
	})

	const totals = async (scope: string, first: CalendarDay, last: CalendarDay) =>
		(
			await adapter.query(
				{
					scope,
					metrics: ['conversions', 'revenue'],
					timezone: 'UTC',
					dateRange: rangeOf(first, last),
				},
				{ payload: booted.payload }
			)
		).totals

	it(`counts the raw floor's day again for a webhook, and keeps the sale once after that day is pruned, on ${db}`, async () => {
		const { engine, state, store } = nativeOf(booted.payload)
		const scope = 'floor'
		const floor = addCalendarDays(TODAY, -2)
		const [landing, wire] = boughtFromCampaign(scope, 'F', at(floor, 360))
		if (!landing || !wire) {
			throw new Error('a campaign visit holds a landing and an order')
		}
		await store.append([landing, wire])
		expect((await engine.aggregate({ scope, day: floor, tz: 'UTC' })).outcome).toBe('completed')
		expect(await totals(scope, floor, TODAY)).toEqual({ conversions: 1, revenue: 9 })
		// Twelve hours after the browser's record, on the day after the floor.
		await purchase(booted.payload, {
			scope,
			hostname: INGEST_HOST,
			orderId: 'F',
			value: 250,
			timestamp: at(addCalendarDays(floor, 1), -360),
		})
		await engine.idle()
		await engine.maintain({ budgetMs: 120_000 })
		expect(await totals(scope, floor, TODAY)).toEqual({ conversions: 1, revenue: 250 })

		// The next day's prune, which turns the browser's record into a tombstone.
		const cut = dayStart(addCalendarDays(floor, 1))
		await state.recordPruned(scope, cut)
		await store.pruneHits({ scope, before: cut, limit: 100 })
		expect(await store.hitById(wire.id)).toMatchObject({ v: '', revenue: 9 })
		expect(await totals(scope, floor, TODAY)).toEqual({ conversions: 1, revenue: 250 })
	})

	it(`counts no closed day again for a repeated browser order beacon, on ${db}`, async () => {
		const { engine, state } = nativeOf(booted.payload)
		const scope = 'repeat'
		const yesterday = addCalendarDays(TODAY, -1)
		await purchase(booted.payload, {
			scope,
			hostname: INGEST_HOST,
			orderId: 'R',
			value: 250,
			timestamp: new Date(dayStart(TODAY).getTime() - MINUTE),
		})
		await engine.aggregate({ scope, day: yesterday, tz: 'UTC' })
		const beacon = () =>
			postBeacon(
				booted.payload,
				{
					hostname: INGEST_HOST,
					type: 'goal',
					name: 'purchase',
					path: '/c',
					value: 9,
					orderId: 'R',
				},
				{ 'x-tenant': scope }
			)
		const status = async () => (await state.markers(scope, yesterday, yesterday))[0]?.status
		expect((await beacon()).status).toBe(202)
		await engine.idle()
		await engine.maintain({ budgetMs: 120_000 })
		const settled = await status()
		expect(settled).not.toBe('dirty')
		for (let i = 0; i < 3; i++) {
			expect((await beacon()).status).toBe(202)
			await engine.idle()
			expect(await status()).toBe(settled)
		}
		expect(await totals(scope, yesterday, TODAY)).toEqual({ conversions: 1, revenue: 250 })
	})
})

describeForDb('analytics native signed order ids', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				revenue: { orderSignature: 'required' },
			}),
		})
		orderKey = orderDigestKey(booted.payload.secret)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`drops an unsigned order id and takes a signed one as one sale with the webhook's however far apart, on ${db}`, async () => {
		const scope = 'signed'
		const send = (orderId: string) =>
			postBeacon(
				booted.payload,
				{ hostname: INGEST_HOST, type: 'goal', name: 'purchase', path: '/c', value: 9, orderId },
				{ 'x-tenant': scope }
			)
		// Refused orders are dropped as a 202, so only the signed one is stored.
		expect((await send('S1')).status).toBe(202)
		const { store } = nativeOf(booted.payload)
		expect(await store.hitById(keyOf('wire', scope, 'S1'))).toBeNull()
		expect((await send(signOrderId(booted.payload, 'S1', { scope: 'other' }) ?? '')).status).toBe(
			202
		)
		expect(await store.hitById(keyOf('wire', scope, 'S1'))).toBeNull()
		expect((await send(signOrderId(booted.payload, 'S1', { scope }) ?? '')).status).toBe(202)
		expect(await store.hitById(keyOf('wire', scope, 'S1'))).toMatchObject({ revenue: 9 })
		const paid = addCalendarDays(today(), -3)
		await purchase(booted.payload, {
			scope,
			hostname: INGEST_HOST,
			orderId: 'S1',
			value: 250,
			timestamp: at(paid),
		})
		const answer = await adapter.query(
			{
				scope,
				metrics: ['conversions', 'revenue', 'events'],
				timezone: 'UTC',
				dateRange: rangeOf(paid, today()),
			},
			{ payload: booted.payload }
		)
		expect(answer.totals).toEqual({ conversions: 1, revenue: 250, events: 1 })
	})
})
