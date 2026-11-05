import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { AGGREGATES_SLUG } from '../../src/native/collections/slugs'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import { addCalendarDays, calendarDayOf, calendarDayStart } from '../../src/timeframe/calendar'
import { hitOf, internal } from './hitFixtures'
import { ingestRequest } from './ingestRequest'
import { aroundNow, nativeOf, storedHits } from './nativeHelpers'

const METRICS = [
	'pageviews',
	'visitors',
	'sessions',
	'bounceRate',
	'avgDuration',
	'scrollDepth',
] as const satisfies AnalyticsQuery['metrics']

/** Each visitor's address, and the place a trusted platform says it is in. */
const visitor = (address: string): Record<string, string> => ({
	'x-real-ip': address,
	'x-vercel-ip-country': 'DE',
	'x-vercel-ip-country-region': 'BE',
	'x-vercel-ip-city': 'Berlin',
})

describeForDb('native measurement modes', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	const ingest = (body: Record<string, unknown>, address: string) =>
		makeIngestHandler({
			geoResolver: platformHeaderResolver,
			target: nativeOf,
			attribution: { trustedPlatform: 'vercel' },
		})(ingestRequest(booted.payload, body, visitor(address)))

	const read = (query: Partial<AnalyticsQuery> = {}) =>
		adapter.query(
			{ metrics: [...METRICS], dateRange: aroundNow(), ...query },
			{ payload: booted.payload }
		)

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		// One visitor before modes, one cookieless, each engaging; one anonymous on two pages.
		await ingest({ type: 'pageview', path: '/a', scrollDepth: 0 }, '10.0.0.1')
		await ingest({ type: 'engagement', path: '/a', durationMs: 4000, scrollDepth: 50 }, '10.0.0.1')
		await ingest({ type: 'pageview', path: '/a', scrollDepth: 0, m: 'c' }, '10.0.0.2')
		await ingest(
			{ type: 'engagement', path: '/a', durationMs: 2000, scrollDepth: 30, m: 'c' },
			'10.0.0.2'
		)
		// Everything a full beacon would carry, claimed anonymous.
		await ingest(
			{ type: 'pageview', path: '/a', m: 'a', durationMs: 9000, scrollDepth: 0 },
			'10.0.0.3'
		)
		await ingest(
			{ type: 'engagement', path: '/a', m: 'a', durationMs: 5000, scrollDepth: 80 },
			'10.0.0.3'
		)
		await ingest(
			{ type: 'pageview', path: '/b', m: 'a', referrer: 'http://h/a', scrollDepth: 0 },
			'10.0.0.3'
		)
		await nativeOf(booted.payload).writer.flush()
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores an anonymous hit with no visitor, country alone, and no engagement', async () => {
		const anonymous = await storedHits(booted.payload, { mode: { equals: 'a' } })
		expect(anonymous).toHaveLength(2)
		for (const hit of anonymous) {
			expect(hit).toMatchObject({ type: 'pageview', v: '', country: 'DE' })
			for (const field of ['region', 'city', 'durationMs', 'scrollDepth']) {
				expect(hit[field] ?? null).toBeNull()
			}
		}
		const engagements = await storedHits(booted.payload, { type: { equals: 'engagement' } })
		expect(engagements.map((hit) => hit.mode).sort()).toEqual(['c', 'f'])
		const cookieless = await storedHits(booted.payload, {
			mode: { equals: 'c' },
			type: { equals: 'pageview' },
		})
		expect(cookieless[0]).toMatchObject({ region: 'BE', city: 'Berlin' })
		expect(cookieless[0]?.v).not.toBe('')
	})

	it('counts anonymous pageviews as pageviews alone, and says how many carry no visitor or consent', async () => {
		const result = await read()
		expect(result.totals).toEqual({
			pageviews: 4,
			visitors: 2,
			sessions: 2,
			bounceRate: 100,
			// 6000 ms over the two pageviews with a visitor, not over all four.
			avgDuration: 3000,
			scrollDepth: 40,
		})
		expect(result.meta.withoutVisitor).toEqual({ pageviews: 2 })
		expect(result.meta.withoutConsent).toEqual({ pageviews: 3 })
	})

	it('counts anonymous pageviews toward their page and country, and says so in a filtered read', async () => {
		const pages = await read({ metrics: ['pageviews', 'visitors'], dimensions: ['page'] })
		expect(
			pages.rows.map((row) => [row.dimensions?.page, row.metrics.pageviews, row.metrics.visitors])
		).toEqual([
			['/a', 3, 2],
			['/b', 1, 0],
		])
		const countries = await read({
			metrics: ['pageviews', 'visitors'],
			dimensions: ['country'],
			filters: [{ dimension: 'page', operator: 'eq', value: '/b' }],
		})
		expect(countries.rows.map((row) => [row.dimensions?.country, row.metrics])).toEqual([
			['DE', { pageviews: 1, visitors: 0 }],
		])
		expect(countries.meta.withoutVisitor).toEqual({ pageviews: 1 })
		expect(countries.meta.withoutConsent).toEqual({ pageviews: 1 })
	})

	it('says nothing of either share where every pageview is full', async () => {
		await ingest({ type: 'pageview', path: '/full' }, '10.0.0.4')
		await nativeOf(booted.payload).writer.flush()
		const result = await read({ filters: [{ dimension: 'page', operator: 'eq', value: '/full' }] })
		expect(result.totals?.pageviews).toBe(1)
		expect(result.meta).not.toHaveProperty('withoutVisitor')
		expect(result.meta).not.toHaveProperty('withoutConsent')
	})

	describe('a closed day', () => {
		const day = addCalendarDays(calendarDayOf(new Date(), 'UTC'), -3)
		const start = calendarDayStart(day, 'UTC')
		const range = { start, end: calendarDayStart(addCalendarDays(day, 1), 'UTC') }
		const scope = ''
		const minute = (n: number): Date => new Date(start.getTime() + (10 * 60 + n) * 60_000)

		beforeAll(async () => {
			const { store, engine } = nativeOf(booted.payload)
			await store.append([
				hitOf(scope, { ts: minute(0), v: 'V1'.padEnd(16, '0'), mode: 'f', landing: true }),
				hitOf(scope, {
					ts: minute(0),
					lastAt: minute(1),
					v: 'V1'.padEnd(16, '0'),
					type: 'engagement',
					durationMs: 6000,
				}),
				hitOf(scope, { ts: minute(2), v: '', mode: 'a', landing: true, country: 'DE' }),
				hitOf(scope, { ts: minute(3), v: '', mode: 'a', ...internal, country: 'DE' }),
			])
			expect((await engine.aggregate({ scope, day, tz: 'UTC' })).outcome).toBe('completed')
		})

		it('reads the counts from its daily totals as from its hits', async () => {
			const result = await read({ dateRange: range })
			expect(result.totals).toMatchObject({
				pageviews: 3,
				visitors: 1,
				sessions: 1,
				avgDuration: 6000,
			})
			expect(result.meta.withoutVisitor).toEqual({ pageviews: 2 })
			expect(result.meta.withoutConsent).toEqual({ pageviews: 2 })
		})

		it('reads a day counted before the new counts as before, with neither share', async () => {
			// What a row written before these counts holds: neither, as the database adds them empty.
			await booted.payload.db.updateMany({
				collection: AGGREGATES_SLUG,
				where: { day: { equals: day } },
				data: { pageviewsWithoutVisitor: null, pageviewsWithoutConsent: null },
			})
			const result = await read({ dateRange: range })
			expect(result.totals).toMatchObject({ pageviews: 3, visitors: 1, avgDuration: 2000 })
			expect(result.meta).not.toHaveProperty('withoutVisitor')
			expect(result.meta).not.toHaveProperty('withoutConsent')
		})
	})
})
