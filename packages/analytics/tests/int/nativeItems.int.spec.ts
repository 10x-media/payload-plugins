import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ITEM_PANEL_METRICS } from '../../src/fields/itemReport'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { itemRefKey, itemRefSignature, signItemRef } from '../../src/native/ingest/itemSignature'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import type { QueryResponse } from '../../src/query/response'
import { DAY_MS } from '../../src/timeframe/tz'
import { ingestRequest } from './ingestRequest'
import { aroundNow, countHits, storedHits } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const routes = routePaths(DEFAULT_ROUTE_BASE)

/** Calendar days around now, in UTC, for the query endpoint's day bounds. */
const day = (offset: number): string =>
	new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

describeForDb('native content items', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let ref: string
	let goneRef: string
	/** What a page carries for each: the ref and the signature the server wrote for it. */
	let signedRef: string
	let signedGoneRef: string

	const endpoint = (path: string): Endpoint => {
		const found = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === path
		)
		if (!found || typeof found.handler !== 'function') {
			throw new Error(`${path} not registered`)
		}
		return found
	}

	/** One beacon from one browser: the agent decides who the visitor is, the header where. */
	const ingest = async (
		body: Record<string, unknown>,
		agent: string,
		country = 'DE'
	): Promise<void> => {
		const res = await endpoint('/_x/e').handler(
			ingestRequest(booted.payload, body, { 'user-agent': agent, 'x-vercel-ip-country': country })
		)
		expect(res.status).toBe(202)
	}

	const query = async (params: string): Promise<QueryResponse> => {
		const res = await endpoint(routes.query).handler({
			payload: booted.payload,
			user: { id: 1, collection: 'users' },
			url: `http://localhost/api${routes.query}?from=${day(-1)}&to=${day(1)}&timezone=UTC&${params}`,
			headers: new Headers(),
		} as unknown as PayloadRequest)
		expect(res.status).toBe(200)
		return (await res.json()) as QueryResponse
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				trustedPlatform: 'vercel',
				collections: { offers: { item: true } },
				revenue: true,
				goals: [
					{
						slug: 'book-demo',
						name: 'Book a demo',
						match: { kind: 'goal' },
						value: { fixed: 500 },
					},
				],
			}),
			db,
			collections: [
				{
					slug: 'offers',
					admin: { useAsTitle: 'title' },
					fields: [{ name: 'title', type: 'text' }],
				},
			],
		})
		const offer = await booted.payload.create({
			collection: 'offers' as never,
			data: { title: 'Spring sale' } as never,
		})
		const gone = await booted.payload.create({
			collection: 'offers' as never,
			data: { title: 'Gone sale' } as never,
		})
		const offerId = (offer as { id: string | number }).id
		const goneId = (gone as { id: string | number }).id
		ref = `offers:${String(offerId)}`
		goneRef = `offers:${String(goneId)}`
		signedRef = signItemRef(booted.payload, 'offers', offerId) ?? ''
		signedGoneRef = signItemRef(booted.payload, 'offers', goneId) ?? ''

		// Three people see the offer: two on /pricing from Germany, one on / from France who also
		// sees an offer deleted afterwards. A ref to a non-item collection is dropped on arrival.
		await ingest({ type: 'pageview', path: '/pricing' }, 'UA-1')
		await ingest(
			{ type: 'engagement', path: '/pricing', durationMs: 3000, impressions: [signedRef] },
			'UA-1'
		)
		await ingest({ type: 'engagement', path: '/pricing', impressions: [signedRef] }, 'UA-2')
		await ingest(
			{ type: 'engagement', path: '/', impressions: [signedRef, signedGoneRef, 'pages:1'] },
			'UA-3',
			'FR'
		)
		// Two of them click it, and one books a demo through it. The first one's later beacons claim
		// another country, which moves no visit: a visit's place is its first hit's.
		await ingest(
			{ type: 'event', name: 'item_click', path: '/pricing', item: signedRef },
			'UA-1',
			'FR'
		)
		await ingest({ type: 'event', name: 'item_click', path: '/', item: signedRef }, 'UA-3', 'FR')
		await ingest(
			{ type: 'goal', name: 'book-demo', path: '/pricing', item: signedRef },
			'UA-1',
			'FR'
		)
		// A click on something that is no item is still a click, filed under no item.
		await ingest({ type: 'event', name: 'item_click', path: '/', item: 'users:1' }, 'UA-2')
		await booted.payload.delete({
			collection: 'offers' as never,
			id: goneRef.slice('offers:'.length),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`counts an item's views, viewers, clicks, conversions and revenue on ${db}`, async () => {
		const result = await adapter.query(
			{
				metrics: ['impressions', 'visitors', 'interactions', 'events', 'conversions', 'revenue'],
				dateRange: aroundNow(),
				item: ref,
			},
			{ payload: booted.payload }
		)
		expect(result.totals).toEqual({
			impressions: 3,
			visitors: 3,
			interactions: 2,
			events: 3,
			conversions: 1,
			revenue: 500,
		})
	})

	it(`lists the pages an item was seen on, exactly, on ${db}`, async () => {
		const result = await adapter.query(
			{ metrics: ['impressions'], dimensions: ['page'], dateRange: aroundNow(), item: ref },
			{ payload: booted.payload }
		)
		expect(result.rows).toEqual([
			{ dimensions: { page: '/pricing' }, metrics: { impressions: 2 } },
			{ dimensions: { page: '/' }, metrics: { impressions: 1 } },
		])
	})

	// A view is kept on the engagement that reported it, a view alone included, and nothing it
	// refused (a collection that is no item) is kept anywhere.
	it(`stores each view on its engagement's row, a view alone included, on ${db}`, async () => {
		const engagements = await storedHits(booted.payload, { type: { equals: 'engagement' } })
		expect(engagements.map((hit) => hit.impressions)).toEqual([[ref], [ref], [ref, goneRef]])
		expect(engagements.map((hit) => hit.durationMs ?? null)).toEqual([3000, null, null])
		expect(await countHits(booted.payload, { item: { equals: 'users:1' } })).toBe(0)
	})

	it(`keeps the item out of the site, page and goal numbers, and the click in the events on ${db}`, async () => {
		const site = await adapter.query(
			{ metrics: ['pageviews', 'events', 'conversions'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(site.totals).toEqual({ pageviews: 1, events: 4, conversions: 1 })
		const pages = await adapter.query(
			{ metrics: ['pageviews', 'events'], dimensions: ['page'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(pages.rows.find((row) => row.dimensions?.page === '/pricing')?.metrics).toEqual({
			pageviews: 1,
			events: 2,
		})
		const events = await adapter.query(
			{ metrics: ['events'], dimensions: ['event'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(events.rows).toEqual([{ dimensions: { event: 'item_click' }, metrics: { events: 3 } }])
		const goals = await adapter.query(
			{ metrics: ['conversions'], dimensions: ['goal'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(goals.rows).toEqual([{ dimensions: { goal: 'book-demo' }, metrics: { conversions: 1 } }])
	})

	it(`reads the item report a document's panel draws on ${db}`, async () => {
		const result = await readForField({
			req: readerRequest(booted.payload),
			collectionSlug: 'offers',
			data: { id: ref.slice('offers:'.length), title: 'Spring sale' },
			metrics: ITEM_PANEL_METRICS,
			timeframe: 'last30days',
			now: new Date(),
			report: 'item',
			series: true,
			dimensions: ['page', 'country', 'device'],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics).toEqual({
			impressions: 3,
			visitors: 3,
			interactions: 2,
			conversions: 1,
			revenue: 500,
		})
		expect(result.points?.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(3)
		const pages = result.breakdowns?.find((block) => block.dimension === 'page')
		expect(pages?.rows).toEqual([
			{ value: '/pricing', metric: 2 },
			{ value: '/', metric: 1 },
		])
		// The people who clicked it: UA-1 from Germany and UA-3 from France. UA-2 only saw it.
		const countries = result.breakdowns?.find((block) => block.dimension === 'country')
		expect(countries?.metric).toBe('visitors')
		expect(Object.fromEntries(countries?.rows.map((row) => [row.value, row.metric]) ?? [])).toEqual(
			{
				DE: 1,
				FR: 1,
			}
		)
		const devices = result.breakdowns?.find((block) => block.dimension === 'device')
		expect(devices?.rows.reduce((sum, row) => sum + row.metric, 0)).toBe(2)
	})

	it(`reads an item's views over a quarter by week, as the panel charts them, on ${db}`, async () => {
		const result = await readForField({
			req: readerRequest(booted.payload),
			collectionSlug: 'offers',
			data: { id: ref.slice('offers:'.length), title: 'Spring sale' },
			metrics: ITEM_PANEL_METRICS,
			timeframe: 'last90days',
			now: new Date(),
			report: 'item',
			series: true,
		})
		expect(result.status).toBe('ok')
		expect(result.seriesGranularity).toBe('week')
		expect(result.points?.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(3)
	})

	it(`names every item in the Content tab by its title, and a deleted one as hidden, on ${db}`, async () => {
		const body = await query(
			'metrics=impressions,interactions,conversions&dimensions=item&order=impressions:desc'
		)
		expect(body.result.rows.map((row) => [row.dimensions?.item, row.metrics.impressions])).toEqual([
			[ref, 3],
			[goneRef, 1],
		])
		expect(body.itemLabels).toEqual({ [ref]: 'Spring sale', [goneRef]: null })
	})

	it(`narrows the whole view to one item by its clicks and goals on ${db}`, async () => {
		const filters = encodeURIComponent(
			JSON.stringify([{ dimension: 'item', operator: 'eq', value: ref }])
		)
		const body = await query(`metrics=events,interactions,conversions&filters=${filters}`)
		expect(body.result.totals).toEqual({ events: 3, interactions: 2, conversions: 1 })
		expect(body.itemLabels).toEqual({ [ref]: 'Spring sale' })
	})

	it(`answers goal completions broken down by item as invalid_param, never a 5xx, on ${db}`, async () => {
		const filters = encodeURIComponent(
			JSON.stringify([{ dimension: 'goal', operator: 'eq', value: 'book-demo' }])
		)
		const res = await endpoint(routes.query).handler({
			payload: booted.payload,
			user: { id: 1, collection: 'users' },
			url: `http://localhost/api${routes.query}?from=${day(-1)}&to=${day(1)}&timezone=UTC&metrics=conversions&dimensions=item&filters=${filters}`,
			headers: new Headers(),
		} as unknown as PayloadRequest)
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({
			error: { code: 'invalid_param', param: 'dimensions' },
		})
	})

	// `x` is neither an ObjectId nor a serial id: the database would refuse to cast it.
	it(`names the real items when a read also names an id no offer could have, on ${db}`, async () => {
		const filters = encodeURIComponent(
			JSON.stringify([
				{ dimension: 'item', operator: 'eq', value: ref },
				{ dimension: 'item', operator: 'eq', value: 'offers:x' },
			])
		)
		const body = await query(`metrics=events&filters=${filters}`)
		expect(body.itemLabels).toEqual({ [ref]: 'Spring sale', 'offers:x': null })
	})

	// Signed with the server's own key: the id check still refuses what no database could cast.
	it(`drops a signed ref whose id no offer could have, keeping its engagement, on ${db}`, async () => {
		const uncastable = `offers:x@${itemRefSignature(itemRefKey(booted.payload.secret), 'offers:x')}`
		await ingest(
			{ type: 'engagement', path: '/forged', durationMs: 2000, impressions: [uncastable] },
			'UA-5'
		)
		const forged = await adapter.query(
			{ metrics: ['impressions'], dateRange: aroundNow(), item: 'offers:x' },
			{ payload: booted.payload }
		)
		expect(forged.totals).toEqual({ impressions: 0 })
		const stored = await storedHits(booted.payload, {
			path: { equals: '/forged' },
			type: { equals: 'engagement' },
		})
		expect(stored).toHaveLength(1)
		expect(stored[0]?.impressions ?? null).toBeNull()
	})

	it(`drops a ref a page sends unsigned or tampered with, keeping its event, on ${db}`, async () => {
		const tampered = `${ref}@${itemRefSignature(itemRefKey(booted.payload.secret), goneRef)}`
		await ingest({ type: 'event', name: 'item_click', path: '/unsigned', item: ref }, 'UA-6')
		await ingest({ type: 'event', name: 'item_click', path: '/unsigned', item: tampered }, 'UA-6')
		const docs = await storedHits(booted.payload, { path: { equals: '/unsigned' } })
		expect(docs).toHaveLength(2)
		expect(docs.map((doc) => doc.item ?? null)).toEqual([null, null])
	})
})
