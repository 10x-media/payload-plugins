import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type {
	AnalyticsFilter,
	AnalyticsQuery,
	AnalyticsResult,
	DimensionKey,
} from '../../src/core/contract'
import { AnalyticsTrackError } from '../../src/core/serverEvent'
import { purchase, refund } from '../../src/goals/serverRevenue'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { AGGREGATES_SLUG } from '../../src/native/collections/slugs'
import { dedupeKeyFor, orderDigestKey } from '../../src/native/ingest/revenue'
import { native } from '../../src/native/nativeAdapter'
import { orderHitId, ulid } from '../../src/native/store/ids'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import type { QueryResponse } from '../../src/query/response'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { DAY_MS } from '../../src/timeframe/tz'
import { INGEST_HOST } from './ingestRequest'
import { countHits, nativeOf, postBeacon, storedHits } from './nativeHelpers'

const EUR = 'eur'
const PLAIN = 'plain'

const configGoals: Goal[] = [{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }]

/** Every order and refund id this spec sends: none of them may be stored in clear. */
const SECRET = 'secret-'

describeForDb('analytics money and order privacy', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	const today = () => calendarDayOf(new Date(), 'UTC')
	const daysAgo = (days: number) => addCalendarDays(today(), -days)
	const noonOf = (day: number) => new Date(calendarDayStart(day, 'UTC').getTime() + DAY_MS / 2)
	const dayRange = (day: number) => ({
		start: calendarDayStart(day, 'UTC'),
		end: new Date(calendarDayStart(addCalendarDays(day, 1), 'UTC').getTime() - 1),
	})
	const aroundNow = () => ({
		start: new Date(Date.now() - DAY_MS),
		end: new Date(Date.now() + 60_000),
	})

	const read = (
		scope: string,
		more: Partial<AnalyticsQuery> & { path?: string } = {}
	): Promise<AnalyticsResult> =>
		adapter.query(
			{ scope, metrics: ['conversions', 'revenue'], dateRange: aroundNow(), ...more },
			{ payload: booted.payload }
		)

	const byCurrency = async (
		scope: string,
		more: Partial<AnalyticsQuery> = {}
	): Promise<Record<string, [number | null | undefined, number | null | undefined]>> => {
		const result = await read(scope, { dimensions: ['currency'] as DimensionKey[], ...more })
		return Object.fromEntries(
			result.rows.map((row) => [
				String(row.dimensions?.currency),
				[row.metrics.conversions, row.metrics.revenue],
			])
		)
	}

	const beacon = (scope: string, body: Record<string, unknown>) =>
		postBeacon(booted.payload, { hostname: INGEST_HOST, ...body }, { 'x-tenant': scope })

	const sale = (scope: string, more: Parameters<typeof purchase>[1]) =>
		purchase(booted.payload, { hostname: INGEST_HOST, scope, ...more })

	/** The query endpoint, as a signed-in reader of the scope reaches it. */
	const queryEndpoint = async (scope: string, params: string): Promise<QueryResponse> => {
		const path = routePaths(DEFAULT_ROUTE_BASE).query
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(each): each is Endpoint => typeof each === 'object' && each.path === path
		)
		if (!endpoint) {
			throw new Error('the query endpoint is mounted')
		}
		const { start, end } = aroundNow()
		const window = `from=${start.toISOString()}&to=${end.toISOString()}`
		const res = await endpoint.handler({
			payload: booted.payload,
			user: { id: 'reader', collection: booted.payload.config.admin.user },
			url: `http://localhost/api${path}?${window}&${params}`,
			headers: new Headers({ 'x-tenant': scope }),
		} as unknown as PayloadRequest)
		expect(res.status).toBe(200)
		return (await res.json()) as QueryResponse
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: configGoals },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				revenue: {
					currency: ({ scope }) => (scope === EUR ? 'EUR' : undefined),
					convert: async ({ amount, from }) => (from === 'GBP' ? amount * 1.2 : undefined),
					dimension: true,
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`keys the currency breakdown by the code sent and counts amounts as sent, on ${db}`, async () => {
		const path = '/money-today'
		await sale(EUR, { orderId: `${SECRET}eur-1`, value: 50, path })
		await sale(EUR, { orderId: `${SECRET}usd-1`, value: 100, currency: 'USD', path })
		await sale(EUR, { orderId: `${SECRET}gbp-1`, value: 10, currency: 'GBP', path })

		expect((await read(EUR, { path })).totals).toEqual({ conversions: 3, revenue: 62 })
		expect(await byCurrency(EUR, { path })).toEqual({
			EUR: [1, 50],
			USD: [1, 100],
			GBP: [1, 10],
		})
		const usd: AnalyticsFilter[] = [{ dimension: 'currency', operator: 'eq', value: 'USD' }]
		expect((await read(EUR, { path, filters: usd })).totals).toEqual({
			conversions: 1,
			revenue: 100,
		})
		const filtered = await queryEndpoint(
			EUR,
			`metrics=revenue&path=${encodeURIComponent(path)}&filters=${encodeURIComponent(JSON.stringify(usd))}`
		)
		expect(filtered.currency).toBe('USD')
		expect(filtered.result.meta.currency).toBe('USD')
		expect(filtered.result.totals).toEqual({ revenue: 100 })
		expect(
			(await queryEndpoint(EUR, `metrics=revenue&path=${encodeURIComponent(path)}`)).currency
		).toBe('EUR')
	})

	it(`reads the same currency rows from a counted day as from its raw hits, on ${db}`, async () => {
		const { engine } = nativeOf(booted.payload)
		const day = daysAgo(2)
		const path = '/money-counted'
		await sale(EUR, {
			orderId: `${SECRET}usd-2`,
			value: 40,
			currency: 'USD',
			path,
			timestamp: noonOf(day),
		})
		await sale(EUR, { orderId: `${SECRET}eur-2`, value: 15, path, timestamp: noonOf(day) })
		const raw = await byCurrency(EUR, { path, dateRange: dayRange(day) })
		expect(await engine.aggregate({ scope: EUR, day, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		expect(await byCurrency(EUR, { path, dateRange: dayRange(day) })).toEqual(raw)
		expect(raw).toEqual({ USD: [1, 40], EUR: [1, 15] })
		const usd: AnalyticsFilter[] = [{ dimension: 'currency', operator: 'eq', value: 'USD' }]
		expect((await read(EUR, { path, dateRange: dayRange(day), filters: usd })).totals).toEqual({
			conversions: 1,
			revenue: 40,
		})
	})

	it(`counts a sale once when the browser sends it first and the webhook after, on ${db}`, async () => {
		const path = '/browser-first'
		const posted = await beacon(EUR, {
			type: 'goal',
			name: 'purchase',
			path,
			value: 30,
			orderId: `${SECRET}a`,
			props: { orderId: `${SECRET}a`, plan: 'pro' },
		})
		expect(posted.status).toBe(202)
		expect((await read(EUR, { path })).totals).toEqual({ conversions: 1, revenue: 30 })
		await sale(EUR, { orderId: `${SECRET}a`, value: 32, path })
		expect((await read(EUR, { path })).totals).toEqual({ conversions: 1, revenue: 32 })
		expect(await countHits(booted.payload, { path: { equals: path } })).toBe(2)
	})

	it(`counts a sale once when the webhook records it first and the browser after, on ${db}`, async () => {
		const path = '/server-first'
		await sale(EUR, { orderId: `${SECRET}b`, value: 40, path })
		await beacon(EUR, { type: 'goal', name: 'purchase', path, value: 38, orderId: `${SECRET}b` })
		await beacon(EUR, { type: 'goal', name: 'purchase', path, value: 38, orderId: `${SECRET}b` })
		expect((await read(EUR, { path })).totals).toEqual({ conversions: 1, revenue: 40 })
		expect(await countHits(booted.payload, { path: { equals: path } })).toBe(2)
	})

	it(`credits a webhook's amount stamped the next day to its browser sale's closed day, counted again, on ${db}`, async () => {
		const { engine, state, store } = nativeOf(booted.payload)
		const day = daysAgo(3)
		const path = '/late-webhook'
		const wire = orderHitId(
			dedupeKeyFor({
				origin: 'wire',
				tenant: EUR,
				goal: 'purchase',
				orderId: `${SECRET}late`,
				key: orderDigestKey(booted.payload.secret),
			})
		)
		await store.append([
			{
				id: wire,
				scope: EUR,
				ts: noonOf(day),
				type: 'goal',
				name: 'purchase',
				hostname: INGEST_HOST,
				path,
				v: 'late-visitor-001',
				landing: false,
				server: false,
				value: 25,
				currency: 'EUR',
				conversions: 1,
				revenue: 25,
				goals: [{ slug: 'purchase', value: 25 }],
			},
		])
		await engine.aggregate({ scope: EUR, day, tz: 'UTC' })
		const closed = async () => (await read(EUR, { path, dateRange: dayRange(day) })).totals
		expect(await closed()).toEqual({ conversions: 1, revenue: 25 })

		const nextDay = addCalendarDays(day, 1)
		await sale(EUR, {
			orderId: `${SECRET}late`,
			value: 26,
			path,
			timestamp: new Date(calendarDayStart(nextDay, 'UTC').getTime() + DAY_MS / 4),
		})
		expect((await state.markers(EUR, day, day))[0]?.status).toBe('dirty')
		await engine.maintain({ budgetMs: 120_000 })
		expect(await closed()).toEqual({ conversions: 1, revenue: 26 })
		expect((await read(EUR, { path, dateRange: dayRange(nextDay) })).totals).toEqual({
			conversions: 0,
			revenue: 0,
		})
	})

	// The browser's record of a sale the webhook recorded too keeps its place in its visit and takes
	// the webhook's sale: a landing followed by a purchase stays one visit with one conversion.
	it(`credits the server's sale to the browser's record in its visit, on ${db}`, async () => {
		const { engine, store } = nativeOf(booted.payload)
		const scope = 'shadow-visit'
		const visitor = 'shadow-visitor-0001'
		const day = daysAgo(2)
		const at = (minutes: number) => new Date(noonOf(day).getTime() + minutes * 60_000)
		const order = (origin: 'wire' | 'server') =>
			orderHitId(
				dedupeKeyFor({
					origin,
					tenant: scope,
					goal: 'purchase',
					orderId: `${SECRET}visit`,
					key: orderDigestKey(booted.payload.secret),
				})
			)
		const purchased = {
			type: 'goal',
			name: 'purchase',
			hostname: INGEST_HOST,
			landing: false,
		} as const
		await store.append([
			{
				id: ulid(at(0)),
				scope,
				ts: at(0),
				type: 'pageview',
				hostname: INGEST_HOST,
				path: '/offer',
				v: visitor,
				landing: true,
				server: false,
				ref: 'news.example',
				source: 'news.example',
				channel: 'referral',
			},
			{
				...purchased,
				id: order('wire'),
				scope,
				ts: at(2),
				path: '/checkout',
				v: visitor,
				server: false,
				value: 9,
				currency: 'EUR',
				conversions: 1,
				revenue: 9,
				goals: [{ slug: 'purchase', value: 9 }],
			},
			{
				...purchased,
				id: order('server'),
				scope,
				ts: at(3),
				path: '/shadow-orders',
				v: '',
				server: true,
				value: 250,
				currency: 'EUR',
				conversions: 1,
				revenue: 250,
				goals: [{ slug: 'purchase', value: 250 }],
			},
		])
		const visit = { sessions: 1, bounces: 0, entries: 1, conversions: 1, revenue: 250 }
		const [raw] = await store.readRaw({
			scope,
			start: dayRange(day).start,
			end: calendarDayStart(addCalendarDays(day, 1), 'UTC'),
			filters: [],
			sessions: true,
			timeoutMs: 10_000,
		})
		expect(raw?.parts).toMatchObject({ ...visit, events: 1, pageviews: 1 })
		const byGoal = await store.readRaw({
			scope,
			start: dayRange(day).start,
			end: calendarDayStart(addCalendarDays(day, 1), 'UTC'),
			filters: [],
			groupBy: 'goal',
			sessions: true,
			timeoutMs: 10_000,
		})
		expect(byGoal.map((row) => [row.value, row.parts.conversions, row.parts.revenue])).toEqual([
			['purchase', 1, 250],
		])

		expect((await engine.aggregate({ scope, day, tz: 'UTC' })).outcome).toBe('completed')
		const metrics = ['sessions', 'bounceRate', 'conversions', 'revenue', 'events'] as const
		const counted = await adapter.query(
			{ scope, metrics: [...metrics], dateRange: dayRange(day), timezone: 'UTC' },
			{ payload: booted.payload }
		)
		expect(counted.meta.partial).toBeUndefined()
		expect(counted.totals).toEqual({
			sessions: 1,
			bounceRate: 0,
			conversions: 1,
			revenue: 250,
			events: 1,
		})
		const currencies = await byCurrency(scope, { dateRange: dayRange(day), timezone: 'UTC' })
		expect(currencies).toEqual({ EUR: [1, 250] })

		const live = 'shadow-live'
		const path = '/live-offer'
		await beacon(live, { type: 'pageview', path, referrer: 'https://news.example/' })
		await beacon(live, { type: 'goal', name: 'purchase', path, value: 9, orderId: `${SECRET}live` })
		await sale(live, { orderId: `${SECRET}live`, value: 250, path: '/live-orders' })
		const today = await adapter.query(
			{ scope: live, metrics: [...metrics], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(today.totals).toEqual({
			sessions: 1,
			bounceRate: 0,
			conversions: 1,
			revenue: 250,
			events: 1,
		})
	})

	it(`counts each partial refund once, as revenue and no conversion, on ${db}`, async () => {
		const path = '/refunded'
		await sale(EUR, { orderId: `${SECRET}r`, value: 80, path })
		const back = (refundId: string, value: number) =>
			refund(booted.payload, {
				hostname: INGEST_HOST,
				scope: EUR,
				path,
				orderId: `${SECRET}r`,
				refundId,
				value,
			})
		await back(`${SECRET}re-1`, 20)
		await back(`${SECRET}re-2`, 10)
		await back(`${SECRET}re-1`, 20)

		expect((await read(EUR, { path })).totals).toEqual({ conversions: 1, revenue: 50 })
		const goals = await read(EUR, { path, dimensions: ['goal'] })
		expect(goals.rows).toEqual([
			{ dimensions: { goal: 'purchase' }, metrics: { conversions: 1, revenue: 50 } },
		])
		expect(await countHits(booted.payload, { path: { equals: path } })).toBe(3)
		await expect(
			refund(booted.payload, {
				hostname: INGEST_HOST,
				scope: EUR,
				path,
				orderId: `${SECRET}r`,
				refundId: '',
				value: 5,
			})
		).rejects.toBeInstanceOf(AnalyticsTrackError)
	})

	it(`says when revenue adds currencies nothing converts, and not otherwise, on ${db}`, async () => {
		const path = '/mixed'
		await sale(PLAIN, { orderId: `${SECRET}m1`, value: 10, currency: 'EUR', path })
		await sale(PLAIN, { orderId: `${SECRET}m2`, value: 20, currency: 'USD', path })
		const mixed = await read(PLAIN, { path })
		expect(mixed.totals).toEqual({ conversions: 2, revenue: 30 })
		expect(mixed.meta.mixedCurrencies).toEqual(['EUR', 'USD'])
		const one = await read(PLAIN, {
			path,
			filters: [{ dimension: 'currency', operator: 'eq', value: 'USD' }],
		})
		expect(one.totals).toEqual({ conversions: 1, revenue: 20 })
		expect(one.meta).not.toHaveProperty('mixedCurrencies')
		expect((await read(EUR)).meta).not.toHaveProperty('mixedCurrencies')
		expect((await read(PLAIN, { metrics: ['pageviews'] })).meta).not.toHaveProperty(
			'mixedCurrencies'
		)
	})

	it(`stores no order or refund id in any path, prop or daily total, on ${db}`, async () => {
		const { engine } = nativeOf(booted.payload)
		await beacon(EUR, {
			type: 'goal',
			name: 'purchase',
			path: '/thanks',
			value: 12,
			orderId: `${SECRET}privacy`,
			props: { orderId: `${SECRET}privacy` },
			items: [{ id: 'sku-1', quantity: 1 }],
		})
		await sale(EUR, { orderId: `${SECRET}privacy-server`, value: 12, items: [{ id: 'sku-1' }] })
		await refund(booted.payload, {
			hostname: INGEST_HOST,
			scope: EUR,
			orderId: `${SECRET}privacy-server`,
			refundId: `${SECRET}privacy-refund`,
			value: 2,
		})
		for (const scope of [EUR, PLAIN]) {
			expect(await engine.snapshot({ scope, day: today(), tz: 'UTC' })).toMatchObject({
				outcome: 'completed',
			})
		}

		const hits = await storedHits(booted.payload)
		expect(hits.length).toBeGreaterThan(10)
		for (const hit of hits) {
			expect(JSON.stringify([hit.path, hit.props])).not.toContain(SECRET)
		}
		expect(hits.filter((hit) => hit.path === '/orders')).toHaveLength(2)
		const totals = await booted.payload.find({
			collection: AGGREGATES_SLUG as never,
			pagination: false,
			depth: 0,
		})
		expect(totals.docs.length).toBeGreaterThan(0)
		for (const row of totals.docs as Array<Record<string, unknown>>) {
			expect(JSON.stringify([row.value, row.value2])).not.toContain(SECRET)
		}
	})
})
