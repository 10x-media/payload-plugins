import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { DAY_MS } from '../../src/timeframe/tz'
import { callEndpoint } from './endpointHelpers'
import { storeEvents } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const routes = routePaths(DEFAULT_ROUTE_BASE)

// Real clock because the endpoint resolves its own `now`; seeded offsets keep 2 views in the
// current 7-day window and 1 in the window before it at any time of day.
const NOW = new Date()

const pageview = (daysAgo: number, visitorId: string): NormalizedEvent => ({
	timestamp: new Date(NOW.getTime() - daysAgo * DAY_MS),
	type: 'pageview',
	path: '/about',
	hostname: 'example.com',
	visitorId,
	durationMs: 30_000,
})

describeForDb('document analytics endpoint', {}, (db) => {
	let booted: BootedPayload
	let pageId: string
	const fakeUser = { id: 'test-user', collection: 'users' }

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug ? `/${doc.slug as string}` : null) } },
			}),
			db,
			collections: [
				{
					slug: 'pages',
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'slug', type: 'text' },
					],
				},
			],
		})
		const page = await booted.payload.create({
			collection: 'pages' as never,
			data: { title: 'About', slug: 'about' } as never,
		})
		pageId = String((page as { id: string | number }).id)
		// Current 7-day window: 2 views; the 7 days before: 1 view.
		await storeEvents(booted.payload, [pageview(1, 'a'), pageview(2, 'b'), pageview(9, 'c')])
	})

	afterAll(async () => {
		await booted.stop()
	})

	const call = (query: string, user?: typeof fakeUser): Promise<Response> =>
		callEndpoint(booted.payload, { path: routes.document, query, user })

	it(`rejects anonymous requests on ${db}`, async () => {
		const res = await call(`collection=pages&id=${pageId}`)
		expect(res.status).toBe(401)
	})

	// The numbers are the caller's own document's, so no shared cache may hold them.
	it(`never lets a shared cache hold a reading on ${db}`, async () => {
		const res = await call(
			`collection=pages&id=${pageId}&timeframe=last7days&metrics=pageviews`,
			fakeUser
		)
		expect(res.status).toBe(200)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})

	it(`returns 404 for an unbound collection on ${db}`, async () => {
		const res = await call(`collection=users&id=${pageId}`, fakeUser)
		expect(res.status).toBe(404)
	})

	it(`returns 404 for a missing document on ${db}`, async () => {
		const res = await call('collection=pages&id=000000000000000000000000', fakeUser)
		expect(res.status).toBe(404)
	})

	it(`rejects a custom timeframe without a valid range on ${db}`, async () => {
		const res = await call(`collection=pages&id=${pageId}&timeframe=custom`, fakeUser)
		expect(res.status).toBe(400)
	})

	it(`reads metrics with comparison and series for a bound document on ${db}`, async () => {
		const res = await call(
			`collection=pages&id=${pageId}&timeframe=last7days&metrics=pageviews&compare=1&series=1`,
			fakeUser
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			status: string
			metrics: { pageviews?: number }
			previousMetrics?: { pageviews?: number }
			comparisonRange?: unknown
			timezone?: string
			points?: Array<{ date: string; value: number }>
		}
		expect(body.status).toBe('ok')
		expect(body.metrics.pageviews).toBe(2)
		expect(body.comparisonRange).toBeDefined()
		expect(body.previousMetrics?.pageviews).toBe(1)
		expect(body.points?.some((p) => p.value > 0)).toBe(true)
		// The panel buckets its trend client-side, so the endpoint hands back the reporting
		// timezone it read in (default UTC here) for the axis to line up with the series.
		expect(body.timezone).toBe('UTC')
	})

	const readAbout = (extra: { compare?: boolean; series?: boolean } = {}) =>
		readForField({
			req: readerRequest(booted.payload),
			collectionSlug: 'pages',
			data: { id: pageId, slug: 'about' },
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
			...extra,
		})

	it(`readForField reports the resolved reporting timezone on ${db}`, async () => {
		const res = await readAbout()
		expect(res.timezone).toBe('UTC')
	})

	it(`readForField omits comparison and series unless requested on ${db}`, async () => {
		const plain = await readAbout()
		expect(plain.previousMetrics).toBeUndefined()
		expect(plain.points).toBeUndefined()
		const rich = await readAbout({ compare: true, series: true })
		expect(rich.metrics.pageviews).toBe(2)
		expect(rich.previousMetrics?.pageviews).toBe(1)
		expect(rich.points?.length).toBeGreaterThan(0)
	})
})
