import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest, TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { DOCUMENT_PATH } from '../../src/plugin/paths'

// Anchored to the real clock because the endpoint resolves its own `now`; the seeded
// offsets keep 2 views in the current 7-day window and 1 in the window before it at
// any time of day.
const NOW = new Date()
const DAY_MS = 86_400_000

const pageview = (daysAgo: number, visitor: string): StoredEvent => ({
	timestamp: new Date(NOW.getTime() - daysAgo * DAY_MS),
	type: 'pageview',
	path: '/about',
	hostname: 'example.com',
	visitorHash: visitor,
	sessionId: `${visitor}-s`,
	durationMs: 30_000,
})

describeForDb('document analytics endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let pageId: string
	const fakeUser = { id: 'test-user', collection: 'users' } as unknown as TypedUser

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
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
		await flushBatch(booted.payload, [pageview(1, 'a'), pageview(2, 'b'), pageview(9, 'c')])
	})

	afterAll(async () => {
		await booted.stop()
	})

	const handler = () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === DOCUMENT_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('document endpoint not registered')
		}
		return endpoint.handler
	}

	const call = async (query: string, user?: TypedUser): Promise<Response> =>
		handler()({
			payload: booted.payload,
			user,
			url: `http://localhost/api${DOCUMENT_PATH}?${query}`,
			headers: new Headers(),
		} as unknown as PayloadRequest)

	it(`rejects anonymous requests on ${db}`, async () => {
		const res = await call(`collection=pages&id=${pageId}`)
		expect(res.status).toBe(401)
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
			points?: Array<{ date: string; value: number }>
		}
		expect(body.status).toBe('ok')
		expect(body.metrics.pageviews).toBe(2)
		expect(body.comparisonRange).toBeDefined()
		expect(body.previousMetrics?.pageviews).toBe(1)
		expect(body.points?.some((p) => p.value > 0)).toBe(true)
	})

	it(`readForField omits comparison and series unless requested on ${db}`, async () => {
		const doc = { id: pageId, slug: 'about' }
		const req = { payload: booted.payload } as unknown as PayloadRequest
		const plain = await readForField({
			req,
			collectionSlug: 'pages',
			data: doc,
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(plain.previousMetrics).toBeUndefined()
		expect(plain.points).toBeUndefined()
		const rich = await readForField({
			req,
			collectionSlug: 'pages',
			data: doc,
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
			compare: true,
			series: true,
		})
		expect(rich.metrics.pageviews).toBe(2)
		expect(rich.previousMetrics?.pageviews).toBe(1)
		expect(rich.points?.length).toBeGreaterThan(0)
	})
})
