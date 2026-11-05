import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsQuery, DimensionKey, MetricKey } from '../../src/core/contract'
import { purchase } from '../../src/goals/serverRevenue'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { dedupeKeyFor, orderDigestKey } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { TWIN_WINDOW_MS } from '../../src/native/store/hits'
import { orderHitId, ulid } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { INGEST_HOST } from './ingestRequest'
import { nativeOf, postBeacon } from './nativeHelpers'

/** Noon UTC: no test here can cross a day boundary, whatever the wall clock says. */
const NOW = new Date('2026-06-15T12:00:00.000Z')

/** Every instant here is the test clock's, which each step advances by a second. */
let clock: TestClock
const tick = (): Date => {
	clock.advance(1000)
	return clock.now()
}

/** A goal worth a fixed amount, which no browser may raise or lower under the default. */
const demo: Goal = {
	slug: 'demo',
	name: 'Demo',
	match: { kind: 'goal' },
	value: { fixed: 500 },
}

/** One install of native on `db`, scoped by the `x-tenant` header, money on with `revenue`. */
const bootWith = (
	db: Parameters<typeof bootPayload>[0]['db'],
	adapter: ReturnType<typeof native>,
	revenue: true | { browserAmounts: 'none' }
) =>
	bootPayload({
		db,
		plugin: analytics({
			adapters: [adapter],
			capture: { gate: 'off' },
			goals: { defaults: [demo] },
			scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
			access: { crossScope: () => true },
			trustedPlatform: 'vercel',
			revenue,
		}),
	})

const aroundNow = () => ({
	start: new Date(clock.now().getTime() - DAY_MS),
	end: new Date(clock.now().getTime() + 60_000),
})

const today = () => calendarDayOf(clock.now(), 'UTC')
const noonOf = (day: number) => new Date(calendarDayStart(day, 'UTC').getTime() + DAY_MS / 2)
const dayRange = (day: number) => ({
	start: calendarDayStart(day, 'UTC'),
	end: new Date(calendarDayStart(addCalendarDays(day, 1), 'UTC').getTime() - 1),
})

describeForDb('analytics sale attribution', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootWith(db, adapter, true)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
		clock.reset()
	})

	const beacon = (scope: string, body: Record<string, unknown>) => {
		tick()
		return postBeacon(
			booted.payload,
			{ hostname: INGEST_HOST, ...body },
			{ 'x-tenant': scope, 'x-vercel-ip-country': 'DE' }
		)
	}

	const query = (scope: string, more: Partial<AnalyticsQuery> = {}) =>
		adapter.query(
			{ scope, metrics: ['conversions', 'revenue'], dateRange: aroundNow(), ...more },
			{ payload: booted.payload }
		)

	/** Conversions and revenue by one dimension's values. */
	const by = async (scope: string, dimension: DimensionKey, more: Partial<AnalyticsQuery> = {}) =>
		Object.fromEntries(
			(await query(scope, { dimensions: [dimension], ...more })).rows.map((row) => [
				String(row.dimensions?.[dimension]),
				[row.metrics.conversions, row.metrics.revenue],
			])
		)

	const VISIT: MetricKey[] = ['sessions', 'bounceRate', 'conversions', 'revenue', 'events']

	const expectCredited = async (scope: string, more: Partial<AnalyticsQuery> = {}) => {
		const totals = (await query(scope, { metrics: VISIT, ...more })).totals
		expect(totals).toEqual({ sessions: 1, bounceRate: 0, conversions: 1, revenue: 250, events: 1 })
		expect(await by(scope, 'channel', more)).toEqual({ email: [1, 250] })
		expect(await by(scope, 'source', more)).toEqual({ news: [1, 250] })
		expect(await by(scope, 'utmCampaign', more)).toEqual({ fall: [1, 250] })
		expect(await by(scope, 'country', more)).toEqual({ DE: [1, 250] })
		expect(await by(scope, 'goal', more)).toEqual({ purchase: [1, 250] })
	}

	// A landing from a campaign, the browser's purchase, then the webhook with the real amount.
	it(`credits the webhook's sale to the campaign visit the browser bought in, on ${db}`, async () => {
		const scope = 'campaign-live'
		await beacon(scope, {
			type: 'pageview',
			path: '/offer',
			query: 'utm_source=news&utm_medium=email&utm_campaign=fall',
		})
		await beacon(scope, {
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			value: 9,
			orderId: 'order-live',
		})
		tick()
		await purchase(booted.payload, {
			hostname: INGEST_HOST,
			scope,
			orderId: 'order-live',
			value: 250,
			path: '/orders',
		})

		await expectCredited(scope)
	})

	it(`credits it the same once the day is counted, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const scope = 'campaign-counted'
		const day = addCalendarDays(today(), -2)
		const at = (minutes: number) => new Date(noonOf(day).getTime() + minutes * 60_000)
		const order = (origin: 'wire' | 'server') =>
			orderHitId(
				dedupeKeyFor({
					origin,
					tenant: scope,
					goal: 'purchase',
					orderId: 'order-counted',
					key: orderDigestKey(booted.payload.secret),
				})
			)
		const visitor = { hostname: INGEST_HOST, v: 'campaign-visitor-01', country: 'DE' }
		const sale = (amount: number) => ({
			value: amount,
			conversions: 1,
			revenue: amount,
			goals: [{ slug: 'purchase', value: amount }],
		})
		const hits: HitRow[] = [
			{
				...visitor,
				id: ulid(at(0)),
				scope,
				ts: at(0),
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
				id: order('wire'),
				scope,
				ts: at(4),
				type: 'goal',
				name: 'purchase',
				path: '/checkout',
				landing: false,
				server: false,
				...sale(9),
			},
			{
				id: order('server'),
				scope,
				ts: at(5),
				type: 'goal',
				name: 'purchase',
				hostname: INGEST_HOST,
				path: '/orders',
				v: '',
				landing: false,
				server: true,
				...sale(250),
			},
		]
		await store.append(hits)
		const counted = { dateRange: dayRange(day), timezone: 'UTC' }
		const raw = await query(scope, { metrics: VISIT, ...counted })
		expect((await engine.aggregate({ scope, day, tz: 'UTC' })).outcome).toBe('completed')
		const aggregated = await query(scope, { metrics: VISIT, ...counted })
		expect(aggregated.meta.partial).toBeUndefined()
		expect(aggregated.totals).toEqual(raw.totals)
		await expectCredited(scope, counted)
	})

	// The webhook can beat the beacon across midnight: the server's day was counted without a twin.
	// Stamped yesterday yet within the twin window of the beacon sent now, so the two pair.
	it(`counts the webhook's closed day again once the browser's record arrives, on ${db}`, async () => {
		const { engine, state } = nativeOf(booted.payload)
		const scope = 'late-beacon'
		const yesterday = addCalendarDays(today(), -1)
		await purchase(booted.payload, {
			hostname: INGEST_HOST,
			scope,
			orderId: 'order-late',
			value: 250,
			timestamp: new Date(tick().getTime() - TWIN_WINDOW_MS + 60_000),
		})
		await engine.aggregate({ scope, day: yesterday, tz: 'UTC' })
		const day = { dateRange: dayRange(yesterday), timezone: 'UTC' }
		expect((await query(scope, day)).totals).toEqual({ conversions: 1, revenue: 250 })
		const [first] = await state.markers(scope, yesterday, yesterday)

		await beacon(scope, {
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			value: 9,
			orderId: 'order-late',
		})
		await engine.idle()
		// Marked dirty with its lease freed, so the maintenance ingest started may count it already.
		const [marked] = await state.markers(scope, yesterday, yesterday)
		expect(marked?.status === 'dirty' || marked?.gen !== first?.gen).toBe(true)
		await engine.maintain({ budgetMs: 120_000 })
		expect((await query(scope, day)).totals).toEqual({ conversions: 0, revenue: 0 })
		const now = { dateRange: dayRange(today()), timezone: 'UTC' }
		expect((await query(scope, now)).totals).toEqual({ conversions: 1, revenue: 250 })
	})

	it(`lets a goal's fixed value win over the browser's and keeps a browser sale, by default, on ${db}`, async () => {
		const scope = 'browser-fixed'
		await beacon(scope, { type: 'goal', name: 'demo', path: '/demo', value: 1_000_000 })
		await beacon(scope, { type: 'goal', name: 'purchase', path: '/checkout', value: 30 })
		expect(await by(scope, 'goal')).toEqual({ demo: [1, 500], purchase: [1, 30] })
	})
})

describeForDb('analytics revenue.browserAmounts none', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootWith(db, adapter, { browserAmounts: 'none' })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
		clock.reset()
	})

	it(`takes no amount from the browser, a fixed value and the server's still counting, on ${db}`, async () => {
		const scope = 'browser-none'
		const send = (body: Record<string, unknown>) => {
			tick()
			return postBeacon(booted.payload, { hostname: INGEST_HOST, ...body }, { 'x-tenant': scope })
		}
		await send({ type: 'goal', name: 'demo', path: '/demo', value: 1_000_000 })
		await send({ type: 'goal', name: 'purchase', path: '/checkout', value: 30 })
		await purchase(booted.payload, {
			hostname: INGEST_HOST,
			scope,
			orderId: 'order-none',
			value: 70,
			path: '/orders',
		})
		const result = await adapter.query(
			{
				scope,
				metrics: ['conversions', 'revenue'],
				dimensions: ['goal'],
				dateRange: aroundNow(),
			},
			{ payload: booted.payload }
		)
		const byGoal = Object.fromEntries(
			result.rows.map((row) => [
				String(row.dimensions?.goal),
				[row.metrics.conversions, row.metrics.revenue],
			])
		)
		expect(byGoal).toEqual({ demo: [1, 500], purchase: [2, 70] })
	})
})
