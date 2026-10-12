import { describe, expect, it } from 'vitest'
import { UnsupportedFilterError } from '../../../core/sourceErrors'
import { dedupeKeyFor } from '../../ingest/revenue'
import { orderHitId, serverTwinOf } from '../ids'
import type { MetricParts } from '../parts'
import type { HitRow, RawRead, RawRow } from '../types'
import { memoryEventStore } from './memoryStore'

let serial = 0

const at = (time: string): Date => new Date(`2026-10-06T${time}Z`)

const hit = (time: string, fields: Partial<HitRow> = {}): HitRow => ({
	id: `H${String(serial++).padStart(6, '0')}`,
	scope: '',
	ts: at(time),
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'V1',
	landing: false,
	server: false,
	source: 'direct',
	channel: 'direct',
	...fields,
})

const google = { landing: true, ref: 'google.com', source: 'google', channel: 'organic-search' }
const bing = { landing: true, ref: 'bing.com', source: 'bing', channel: 'organic-search' }

const engagement = (time: string, lastAt: string, fields: Partial<HitRow> = {}): HitRow => ({
	id: `H${String(serial++).padStart(6, '0')}`,
	scope: '',
	ts: at(time),
	lastAt: at(lastAt),
	type: 'engagement',
	hostname: 'a.example',
	path: '/',
	v: 'V1',
	landing: false,
	server: false,
	...fields,
})

const day = (more: Partial<RawRead> = {}): RawRead => ({
	start: at('00:00:00.000'),
	end: new Date('2026-10-07T00:00:00.000Z'),
	filters: [],
	sessions: true,
	timeoutMs: 1000,
	...more,
})

const storeWith = async (hits: HitRow[]) => {
	const store = memoryEventStore()
	await store.append(hits)
	return store
}

const pick = (rows: readonly RawRow[], keys: ReadonlyArray<keyof MetricParts>) =>
	rows.map((row) => ({
		value: row.value,
		...Object.fromEntries(keys.map((key) => [key, row.parts[key]])),
	}))

describe('memoryEventStore visits', () => {
	it('opens a visit more than 30 minutes after the latest activity, never at exactly 30', async () => {
		const store = await storeWith([
			hit('10:00:00.000', google),
			hit('10:30:00.000'),
			hit('11:00:00.001'),
			hit('11:30:00.001'),
		])
		const [total] = await store.readRaw(day())
		expect(total?.parts).toMatchObject({ pageviews: 4, sessions: 2, entries: 2, bounces: 0 })
	})

	it("stretches a visit to an engagement's lastAt, even one that arrived before its pageview", async () => {
		const store = await storeWith([
			engagement('10:00:00.000', '10:40:00.000', { durationMs: 2_400_000 }),
			hit('10:00:00.020', google),
			hit('11:05:00.000'),
		])
		const [total] = await store.readRaw(day())
		expect(total?.parts).toMatchObject({
			sessions: 1,
			entries: 1,
			sessionMs: 2_400_000,
			durationMs: 2_400_000,
		})
		expect(
			pick(await store.readRaw(day({ groupBy: 'source' })), ['sessions', 'pageviews'])
		).toEqual([{ value: 'google', sessions: 1, pageviews: 2 }])
	})

	it("carries the latest landing visit's attribution into a visit opened by an internal link", async () => {
		const store = await storeWith([
			hit('09:00:00.000', { ...google, utmCampaign: 'spring' }),
			hit('10:00:00.000', { path: '/b' }),
			hit('12:00:00.000', bing),
			hit('13:00:00.000', { path: '/c' }),
		])
		expect(pick(await store.readRaw(day({ groupBy: 'source' })), ['sessions'])).toEqual([
			{ value: 'bing', sessions: 2 },
			{ value: 'google', sessions: 2 },
		])
		expect(pick(await store.readRaw(day({ groupBy: 'utmCampaign' })), ['sessions'])).toEqual([
			{ value: 'spring', sessions: 2 },
		])
	})

	it('reads a visit before any landing that day from its own first hit', async () => {
		const store = await storeWith([
			hit('09:00:00.000', { utmSource: 'mail', source: 'mail' }),
			hit('11:00:00.000'),
		])
		expect(pick(await store.readRaw(day({ groupBy: 'source' })), ['sessions'])).toEqual([
			{ value: 'direct', sessions: 1 },
			{ value: 'mail', sessions: 1 },
		])
	})

	it('splits at midnight, where the visitor id changes with the salt', async () => {
		const store = await storeWith([
			hit('23:50:00.000', google),
			{ ...hit('00:05:00.000', { v: 'V2' }), ts: new Date('2026-10-07T00:05:00.000Z') },
		])
		const rows = await store.readRaw(
			day({ end: new Date('2026-10-08T00:00:00.000Z'), groupBy: 'source' })
		)
		expect(pick(rows, ['sessions', 'visitors'])).toEqual([
			{ value: 'direct', sessions: 1, visitors: 1 },
			{ value: 'google', sessions: 1, visitors: 1 },
		])
	})

	it('bounces one pageview with no event or goal, whatever engagement follows it', async () => {
		const store = await storeWith([
			hit('10:00:00.000', { ...google, v: 'A' }),
			engagement('10:00:00.010', '10:01:00.000', { v: 'A', durationMs: 30_000 }),
			hit('10:00:00.000', { ...google, v: 'B' }),
			hit('10:01:00.000', { v: 'B', type: 'event', name: 'signup' }),
			hit('10:00:00.000', { v: 'C', type: 'event', name: 'signup', path: '/x' }),
		])
		const [total] = await store.readRaw(day())
		expect(total?.parts).toMatchObject({ entries: 3, bounces: 1 })
		expect(pick(await store.readRaw(day({ groupBy: 'page' })), ['entries', 'bounces'])).toEqual([
			{ value: '/', entries: 2, bounces: 1 },
			{ value: '/x', entries: 1, bounces: 0 },
		])
	})

	it('puts a hit with no visitor in no visit and no visitor count, under its own attributes', async () => {
		const visitless = (time: string, fields: Partial<HitRow>): HitRow => {
			const row = hit(time, {
				v: '',
				type: 'goal',
				server: true,
				conversions: 1,
				revenue: 5,
				goals: [{ slug: 'purchase', value: 5 }],
				...fields,
			})
			Reflect.deleteProperty(row, 'source')
			Reflect.deleteProperty(row, 'channel')
			return { ...row, ...fields }
		}
		const store = await storeWith([
			visitless('10:00:00.000', {}),
			visitless('10:05:00.000', { source: 'news', channel: 'email', revenue: -2 }),
		])
		const [total] = await store.readRaw(day())
		expect(total?.parts).toMatchObject({
			events: 2,
			visitors: 0,
			sessions: 0,
			entries: 0,
			conversions: 2,
			revenue: 3,
		})
		const bySource = await store.readRaw(day({ groupBy: 'source' }))
		expect(bySource.map((row) => [row.value, row.parts.events, row.parts.visitors])).toEqual([
			['news', 1, 0],
		])
	})

	it('counts nothing about visits it did not cut', async () => {
		const store = await storeWith([hit('10:00:00.000', google)])
		const [total] = await store.readRaw(day({ sessions: false }))
		expect(total?.parts).toMatchObject({ pageviews: 1, visitors: 1, sessions: null, bounces: null })
	})
})

describe('memoryEventStore facts and filters', () => {
	const hits = (): HitRow[] => [
		hit('10:00:00.000', { ...google, path: '/pricing', country: 'DE', scrollDepth: 0 }),
		engagement('10:00:00.010', '10:02:00.000', {
			path: '/pricing',
			durationMs: 60_000,
			scrollDepth: 50,
			impressions: ['offers:1', 'offers:2'],
		}),
		hit('10:05:00.000', {
			type: 'event',
			name: 'item_click',
			item: 'offers:1',
			path: '/pricing',
		}),
		hit('10:06:00.000', {
			type: 'goal',
			name: 'purchase',
			path: '/checkout',
			value: 7.5,
			currency: 'EUR',
			conversions: 2,
			revenue: 7.5,
			item: 'offers:1',
			goals: [
				{ slug: 'purchase', value: 7.5 },
				{ slug: 'any-sale', value: 0 },
			],
		}),
		hit('10:07:00.000', {
			type: 'goal',
			name: 'purchase',
			path: '/api/webhook',
			server: true,
			item: 'offers:1',
			conversions: 1,
			revenue: 2.5,
			goals: [{ slug: 'purchase', value: 2.5 }],
		}),
		hit('11:00:00.000', { ...bing, v: 'V2', path: '/blog/a_b', country: 'US' }),
	]

	it('counts each goal completion with its own value', async () => {
		const store = await storeWith(hits())
		expect(
			pick(await store.readRaw(day({ groupBy: 'goal' })), ['conversions', 'revenue', 'events'])
		).toEqual([
			{ value: 'any-sale', conversions: 1, revenue: 0, events: 1 },
			{ value: 'purchase', conversions: 2, revenue: 10, events: 2 },
		])
		const [purchase] = await store.readRaw(
			day({ filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }] })
		)
		expect(purchase?.parts).toMatchObject({ conversions: 2, revenue: 10 })
	})

	it("counts an item's views and clicks, and its pages without server hits", async () => {
		const store = await storeWith(hits())
		expect(
			pick(await store.readRaw(day({ groupBy: 'item', sessions: false })), [
				'impressions',
				'interactions',
				'events',
				'conversions',
				'visitors',
				'pageviews',
			])
		).toEqual([
			{
				value: 'offers:1',
				impressions: 1,
				interactions: 1,
				events: 3,
				conversions: 3,
				visitors: 1,
				pageviews: null,
			},
			{
				value: 'offers:2',
				impressions: 1,
				interactions: 0,
				events: 0,
				conversions: 0,
				visitors: 1,
				pageviews: null,
			},
		])
		expect(
			pick(await store.readRaw(day({ item: 'offers:1', groupBy: 'page', sessions: false })), [
				'impressions',
				'events',
			])
		).toEqual([
			{ value: '/checkout', impressions: 0, events: 1 },
			{ value: '/pricing', impressions: 1, events: 1 },
		])
	})

	it('reads time and scroll from pageviews and engagements, a scroll sample from pageviews', async () => {
		const store = await storeWith(hits())
		const [page] = await store.readRaw(day({ path: '/pricing' }))
		expect(page?.parts).toMatchObject({
			pageviews: 1,
			durationMs: 60_000,
			scrollSum: 50,
			scrollSamples: 1,
			interactions: 1,
		})
	})

	it('filters with eq, contains (its wildcards literal) and matches', async () => {
		const store = await storeWith(hits())
		const pages = async (filter: RawRead['filters'][number]) =>
			(await store.readRaw(day({ groupBy: 'page', filters: [filter] }))).map((row) => row.value)
		expect(await pages({ dimension: 'page', operator: 'contains', value: 'A_B' })).toEqual([
			'/blog/a_b',
		])
		expect(await pages({ dimension: 'page', operator: 'contains', value: '%' })).toEqual([])
		expect(
			await pages({ dimension: 'page', operator: 'matches', value: '^/(pricing|checkout)$' })
		).toEqual(['/checkout', '/pricing'])
		expect(await pages({ dimension: 'country', operator: 'eq', value: 'US' })).toEqual([
			'/blog/a_b',
		])
	})

	it('buckets by the last start at or before each hit', async () => {
		const store = await storeWith(hits())
		const rows = await store.readRaw(
			day({ buckets: [at('00:00:00.000'), at('10:05:00.000'), at('11:00:00.000')] })
		)
		expect(rows.map((row) => [row.bucket, row.parts.pageviews, row.parts.events])).toEqual([
			[0, 1, 0],
			[1, 0, 3],
			[2, 1, 0],
		])
	})

	it('ranks and limits, fills exact values, and refuses no filter it has', async () => {
		const store = await storeWith(hits())
		const top = await store.readRaw(
			day({ groupBy: 'page', order: { part: 'events', dir: 'desc' }, limit: 2 })
		)
		expect(top.map((row) => row.value)).toEqual(['/api/webhook', '/checkout'])
		const filled = await store.readRaw(day({ groupBy: 'page', values: ['/pricing', '/nope'] }))
		expect(filled.map((row) => row.value)).toEqual(['/pricing'])
		await expect(
			store.readRaw(day({ filters: [{ dimension: 'campaign', operator: 'eq', value: 'x' }] }))
		).rejects.toBeInstanceOf(UnsupportedFilterError)
	})
})

describe('memoryEventStore realtime, windows and scopes', () => {
	it('counts the live window by minute, with pages and sources', async () => {
		const store = await storeWith([
			hit('10:01:10.000', google),
			hit('10:02:30.000', { ...bing, v: 'V2', path: '/b' }),
			hit('10:40:00.000', { v: 'V3' }),
		])
		const live = await store.realtime({
			start: at('10:00:00.000'),
			end: at('10:30:00.000'),
			timeoutMs: 1000,
		})
		expect(live).toEqual({
			visitors: 2,
			pageviews: 2,
			minutes: [
				{ minute: at('10:01:00.000'), visitors: 1, pageviews: 1 },
				{ minute: at('10:02:00.000'), visitors: 1, pageviews: 1 },
			],
			pages: [
				{ value: '/', visitors: 1, pageviews: 1 },
				{ value: '/b', visitors: 1, pageviews: 1 },
			],
			sources: [
				{ value: 'bing', visitors: 1, pageviews: 1 },
				{ value: 'google', visitors: 1, pageviews: 1 },
			],
		})
	})

	it('writes an id once, says whether a window has hits, and lists scopes by code point', async () => {
		const store = memoryEventStore()
		const first = hit('10:00:00.000', { scope: 'b' })
		expect(await store.append([first, first, hit('10:00:00.000', { scope: 'B' })])).toEqual({
			written: 2,
			duplicates: 1,
		})
		expect(await store.append([first])).toEqual({ written: 0, duplicates: 1 })
		expect(
			await store.hasHits({ scope: 'b', start: at('09:00:00.000'), end: at('11:00:00.000') })
		).toBe(true)
		expect(
			await store.hasHits({ scope: 'b', start: at('10:00:00.001'), end: at('11:00:00.000') })
		).toBe(false)
		expect(await store.scopes()).toEqual(['B', 'b'])
	})
})

describe('memoryEventStore upkeep', () => {
	it('finds a scope’s oldest hit and prunes its older hits a bounded chunk at a time', async () => {
		const store = await storeWith([
			hit('08:00:00.000', { scope: 's' }),
			hit('09:00:00.000', { scope: 's' }),
			hit('10:00:00.000', { scope: 's' }),
			hit('07:00:00.000', { scope: 'other' }),
		])
		expect(await store.oldestHit('s')).toEqual(at('08:00:00.000'))
		expect(await store.oldestHit('none')).toBeNull()
		const before = at('10:00:00.000')
		expect(await store.pruneHits({ scope: 's', before, limit: 1 })).toBe(1)
		expect(await store.pruneHits({ scope: 's', before, limit: 5 })).toBe(1)
		expect(await store.pruneHits({ scope: 's', before, limit: 5 })).toBe(0)
		expect(await store.oldestHit('s')).toEqual(at('10:00:00.000'))
		expect(await store.oldestHit('other')).toEqual(at('07:00:00.000'))
		await expect(store.pruneHits({ scope: 's', before, limit: 0 })).rejects.toThrow(/whole size/)
	})

	it("keeps an order's record as its tombstone when pruning, until its days' totals go", async () => {
		const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_t' }))
		const order = hit('09:30:00.000', {
			id: wire,
			scope: 's',
			type: 'goal',
			name: 'purchase',
			country: 'DE',
			utmCampaign: 'fall',
			props: { plan: 'pro' },
			item: 'offers:1',
			goals: [{ slug: 'purchase', value: 9 }],
			conversions: 1,
			revenue: 9,
		})
		const store = await storeWith([hit('09:00:00.000', { scope: 's' }), order])
		const before = at('10:00:00.000')
		expect(await store.pruneHits({ scope: 's', before, limit: 10 })).toBe(2)
		expect(await store.pruneHits({ scope: 's', before, limit: 10 })).toBe(0)
		expect(await store.hitById(wire)).toEqual({
			id: wire,
			scope: 's',
			ts: order.ts,
			type: 'goal',
			hostname: 'a.example',
			path: '/',
			v: '',
			landing: false,
			server: false,
			name: 'purchase',
			item: 'offers:1',
			goals: [{ slug: 'purchase', value: 9 }],
			conversions: 1,
			revenue: 9,
		})
		expect(await store.pruneHits({ scope: 's', from: before, before, limit: 10 })).toBe(0)
		expect(await store.expireOrders({ scope: 's', before: order.ts, limit: 10 })).toBe(0)
		expect(await store.expireOrders({ scope: 's', before, limit: 10 })).toBe(1)
		expect(await store.oldestHit('s')).toBeNull()
	})

	it("finds a visitor's latest landing before a hit, and a scope's orders in a window", async () => {
		const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_l' }))
		const store = await storeWith([
			hit('08:00:00.000', { ...google, v: 'L1' }),
			hit('09:00:00.000', { ...bing, v: 'L1' }),
			hit('09:30:00.000', { ...bing, v: 'L2' }),
			hit('10:00:00.000', { id: wire, v: 'L1', type: 'goal', name: 'purchase' }),
			hit('11:00:00.000', { ...google, v: 'L1' }),
		])
		const landing = await store.latestLanding({
			scope: '',
			hostname: 'a.example',
			v: 'L1',
			start: at('00:00:00.000'),
			end: at('10:00:00.000'),
		})
		expect(landing).toMatchObject({ v: 'L1', ref: 'bing.com', ts: at('09:00:00.000') })
		expect(
			await store.latestLanding({
				scope: '',
				hostname: 'a.example',
				v: 'L3',
				start: at('00:00:00.000'),
				end: at('12:00:00.000'),
			})
		).toBeNull()
		const window = { scope: '', start: at('00:00:00.000'), end: at('12:00:00.000'), limit: 5 }
		expect(await store.ordersIn(window)).toEqual([{ id: wire, ts: at('10:00:00.000') }])
		expect(await store.ordersIn({ ...window, start: at('10:00:00.001') })).toEqual([])
	})

	it('reclassifies only the window’s hits of an older taxonomy, matching null as absent', async () => {
		const old = { landing: true, channelVersion: 0, channel: 'referral' }
		const store = await storeWith([
			hit('10:00:00.000', { ...old, v: 'R1', ref: 'google.com' }),
			hit('10:05:00.000', { ...old, v: 'R2', utmMedium: 'email', utmSource: 'news' }),
			hit('10:10:00.000', { ...old, v: 'R3', ref: 'google.com', channelVersion: 1 }),
			hit('11:30:00.000', { ...old, v: 'R4', ref: 'google.com' }),
			engagement('10:00:00.000', '10:02:00.000', { v: 'R1' }),
		])
		const changed = await store.reclassify({
			scope: '',
			start: at('10:00:00.000'),
			end: at('11:00:00.000'),
			version: 1,
			classify: (tuple) => (tuple.ref === null ? 'email' : 'organic-search'),
		})
		expect(changed).toBe(2)
		const rows = await store.readRaw(day({ groupBy: 'channel', sessions: false }))
		const byChannel = pick(rows, ['pageviews']).sort((a, b) =>
			String(a.value).localeCompare(String(b.value))
		)
		expect(byChannel).toEqual([
			{ value: 'email', pageviews: 1 },
			{ value: 'organic-search', pageviews: 1 },
			{ value: 'referral', pageviews: 2 },
		])
	})
})

describe('memoryEventStore money', () => {
	const sale = (time: string, fields: Partial<HitRow>): HitRow =>
		hit(time, { type: 'goal', name: 'purchase', path: '/checkout', ...fields })
	const completed = (value: number, slugs = ['purchase'], sent?: number) =>
		slugs.map((slug) => ({ slug, value, ...(sent === undefined ? {} : { sent }) }))
	const plain = (more: Partial<RawRead> = {}) => day({ sessions: false, ...more })

	it('keys currency by the code an amount was sent in, and counts each amount as sent', async () => {
		const store = await storeWith([
			sale('10:00:00.000', {
				value: 50,
				currency: 'EUR',
				goals: completed(50),
				conversions: 1,
				revenue: 50,
			}),
			sale('10:05:00.000', {
				v: 'V2',
				value: 0,
				currency: 'EUR',
				originalValue: 100,
				originalCurrency: 'USD',
				goals: completed(0, ['purchase'], 100),
				conversions: 1,
				revenue: 0,
			}),
			sale('10:10:00.000', {
				v: 'V3',
				value: 92,
				currency: 'EUR',
				originalValue: 100,
				originalCurrency: 'USD',
				goals: completed(92, ['purchase', 'any-sale'], 100),
				conversions: 2,
				revenue: 184,
			}),
		])
		const keys = ['conversions', 'revenue'] as const
		expect(pick(await store.readRaw(plain({ groupBy: 'currency' })), keys)).toEqual([
			{ value: 'EUR', conversions: 1, revenue: 50 },
			{ value: 'USD', conversions: 3, revenue: 300 },
		])
		expect(pick(await store.readRaw(plain()), keys)).toEqual([
			{ value: null, conversions: 4, revenue: 234 },
		])
		const usd = plain({ filters: [{ dimension: 'currency', operator: 'eq', value: 'USD' }] })
		expect(pick(await store.readRaw(usd), keys)).toEqual([
			{ value: null, conversions: 3, revenue: 300 },
		])
		const purchases = plain({
			groupBy: 'currency',
			filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
		})
		expect(pick(await store.readRaw(purchases), keys)).toEqual([
			{ value: 'EUR', conversions: 1, revenue: 50 },
			{ value: 'USD', conversions: 2, revenue: 200 },
		])
	})

	it('counts a refund in revenue and as no conversion, by goal as in total', async () => {
		const store = await storeWith([
			sale('10:00:00.000', { value: 49, goals: completed(49), conversions: 1, revenue: 49 }),
			sale('11:00:00.000', { value: -20, goals: completed(-20), conversions: 0, revenue: -20 }),
		])
		const keys = ['conversions', 'revenue'] as const
		expect(pick(await store.readRaw(plain()), keys)).toEqual([
			{ value: null, conversions: 1, revenue: 29 },
		])
		expect(pick(await store.readRaw(plain({ groupBy: 'goal' })), keys)).toEqual([
			{ value: 'purchase', conversions: 1, revenue: 29 },
		])
	})

	it("counts the server's own sale and the browser record without one when they lie more than a day apart", async () => {
		const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_far' }))
		const browser = sale('10:00:00.000', {
			id: wire,
			value: 40,
			goals: completed(40),
			conversions: 1,
			revenue: 40,
		})
		const store = await storeWith([
			browser,
			{
				...browser,
				id: serverTwinOf(wire) ?? '',
				ts: new Date('2026-10-07T10:00:00.001Z'),
				v: '',
				server: true,
				value: 45,
				goals: completed(45),
				revenue: 45,
			},
		])
		const keys = ['events', 'conversions', 'revenue'] as const
		const both = plain({ end: new Date('2026-10-08T00:00:00.000Z') })
		expect(pick(await store.readRaw(both), keys)).toEqual([
			{ value: null, events: 2, conversions: 1, revenue: 45 },
		])
		expect(pick(await store.readRaw(plain()), keys)).toEqual([
			{ value: null, events: 1, conversions: 0, revenue: 0 },
		])
	})

	it("credits the server record's sale to the browser record, on another day, and counts the server record nowhere", async () => {
		const wire = orderHitId(dedupeKeyFor({ origin: 'wire', goal: 'purchase', orderId: 'ord_1' }))
		const browser = sale('10:00:00.000', {
			id: wire,
			value: 40,
			goals: completed(40),
			conversions: 1,
			revenue: 40,
		})
		const store = await storeWith([browser])
		const keys = ['events', 'conversions', 'revenue'] as const
		expect(pick(await store.readRaw(plain()), keys)).toEqual([
			{ value: null, events: 1, conversions: 1, revenue: 40 },
		])
		const settled = new Date('2026-10-07T09:00:00.000Z')
		await store.append([
			{
				...browser,
				id: serverTwinOf(wire) ?? '',
				ts: settled,
				v: '',
				server: true,
				value: 45,
				currency: 'EUR',
				goals: completed(45),
				revenue: 45,
			},
		])
		expect(pick(await store.readRaw(plain()), keys)).toEqual([
			{ value: null, events: 1, conversions: 1, revenue: 45 },
		])
		expect(pick(await store.readRaw(plain({ groupBy: 'goal' })), keys)).toEqual([
			{ value: 'purchase', events: 1, conversions: 1, revenue: 45 },
		])
		expect(pick(await store.readRaw(plain({ groupBy: 'currency' })), keys)).toEqual([
			{ value: 'EUR', events: 1, conversions: 1, revenue: 45 },
		])
		const serverDay = plain({
			start: new Date('2026-10-07T00:00:00.000Z'),
			end: new Date('2026-10-08T00:00:00.000Z'),
		})
		expect(pick(await store.readRaw(serverDay), keys)).toEqual([
			{ value: null, events: 0, conversions: 0, revenue: 0 },
		])
		expect((await store.hitById(serverTwinOf(wire) ?? ''))?.ts).toEqual(settled)
		expect(await store.hitById('os.unknown')).toBeNull()
	})
})
