import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest, TypedUser, WidgetInstance } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { DOCUMENT_PATH } from '../../src/plugin/paths'
import { getRuntime } from '../../src/plugin/runtime'
import { warmTask } from '../../src/plugin/warmTask'
import { resolveCustomRange } from '../../src/widgets/range'
import { readForWidget } from '../../src/widgets/readForWidget'

const TZ = 'Europe/Berlin'

// Jun 23 in Berlin runs 2026-06-22T22:00Z .. 2026-06-23T21:59:59.999Z, so the two evening
// events straddle the final day the picker shows as included.
const LAST_DAY_EVENING = '2026-06-23T21:30:00.000Z'
const NEXT_DAY_EARLY = '2026-06-23T22:30:00.000Z'
const FIRST_DAY = '2026-06-01T06:00:00.000Z'

// What the dayOnly picker stores for an admin sitting in Berlin who picks Jun 1 .. Jun 23.
const BERLIN_ADMIN_PICK = { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' }

const pageview = (timestamp: string, visitor: string): StoredEvent => ({
	timestamp: new Date(timestamp),
	type: 'pageview',
	path: '/about',
	hostname: 'example.com',
	visitorHash: visitor,
	sessionId: `${visitor}-s`,
	// Ingest stamps the reporting timezone on each event so rollups bucket on that zone's day.
	timezone: TZ,
})

describeForDb('custom ranges in the reporting timezone', {}, (db) => {
	let booted: BootedPayload
	let pageId: string
	const fakeUser = { id: 'test-user', collection: 'users' } as unknown as TypedUser

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				reportingTimezone: TZ,
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
		await flushBatch(booted.payload, [
			pageview(FIRST_DAY, 'a'),
			pageview(LAST_DAY_EVENING, 'b'),
			pageview(NEXT_DAY_EARLY, 'c'),
		])
	})

	afterAll(async () => {
		await booted.stop()
	})

	const call = async (query: string): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === DOCUMENT_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('document endpoint not registered')
		}
		return endpoint.handler({
			payload: booted.payload,
			user: fakeUser,
			url: `http://localhost/api${DOCUMENT_PATH}?${query}`,
			headers: new Headers(),
		} as unknown as PayloadRequest)
	}

	it(`reads day bounds inclusively in the reporting timezone on ${db}`, async () => {
		const res = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-01&to=2026-06-23`
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			metrics: { pageviews?: number }
			dateRange: { start: string; end: string }
			timezone: string
		}
		expect(body.dateRange.start).toBe('2026-05-31T22:00:00.000Z')
		expect(body.dateRange.end).toBe('2026-06-23T21:59:59.999Z')
		expect(body.timezone).toBe(TZ)
		// Jun 1 and the Jun 23 evening; the 00:30 on Jun 24 stays out.
		expect(body.metrics.pageviews).toBe(2)
	})

	it(`accepts an offset-bearing datetime and rejects an offset-less one on ${db}`, async () => {
		const withOffset = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-01T00:00:00%2B02:00&to=2026-06-23T23:59:59%2B02:00`
		)
		expect(withOffset.status).toBe(200)
		expect(
			((await withOffset.json()) as { metrics: { pageviews?: number } }).metrics.pageviews
		).toBe(2)

		const naive = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-01T00:00:00&to=2026-06-23T23:59:59`
		)
		expect(naive.status).toBe(400)
		expect(await naive.json()).toEqual({ error: 'invalid range' })
	})

	it(`accepts a single-day window and rejects an inverted one on ${db}`, async () => {
		const oneDay = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-23&to=2026-06-23`
		)
		expect(oneDay.status).toBe(200)
		expect(((await oneDay.json()) as { metrics: { pageviews?: number } }).metrics.pageviews).toBe(1)

		const inverted = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-23&to=2026-06-01`
		)
		expect(inverted.status).toBe(400)
	})

	it(`rejects two equal instants as a zero-width window on ${db}`, async () => {
		const res = await call(
			`collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=2026-06-23T10:00:00Z&to=2026-06-23T10:00:00Z`
		)
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({ error: 'invalid range' })
	})

	it(`warms the very cache key a custom-range widget then asks for on ${db}`, async () => {
		const layout: WidgetInstance[] = [
			{
				widgetSlug: 'analytics-metric',
				width: 'small',
				data: { metric: 'visitors', timeframe: 'custom', range: BERLIN_ADMIN_PICK },
			},
		]
		const handler = warmTask('*/30 * * * *', layout).handler
		if (typeof handler !== 'function') {
			throw new Error('warm task handler must be a function')
		}
		const req = { payload: booted.payload } as unknown as PayloadRequest
		const output = (await handler({ req } as unknown as Parameters<typeof handler>[0])) as {
			output: { warmed: number; failed: number }
		}
		expect(output.output).toEqual({ warmed: 1, failed: 0 })

		const adapter = getRuntime(booted.payload)?.registry.default()
		if (!adapter) {
			throw new Error('runtime adapter missing after boot')
		}
		const spy = vi.spyOn(adapter, 'query')
		const live = await readForWidget({
			req,
			metrics: ['visitors'],
			timeframe: 'last30days',
			now: new Date(),
			range: resolveCustomRange('custom', BERLIN_ADMIN_PICK, TZ),
			timezone: TZ,
		})
		expect(live.status).toBe('ok')
		expect(spy).not.toHaveBeenCalled()
		spy.mockRestore()
	})

	it(`widget reads cover the whole final day the admin picked on ${db}`, async () => {
		const range = resolveCustomRange('custom', BERLIN_ADMIN_PICK, TZ)
		expect(range?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')
		const result = await readForWidget({
			req: { payload: booted.payload } as unknown as PayloadRequest,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
			range,
			timezone: TZ,
			// A filter routes the native adapter through raw events rather than day rollups,
			// where the end bound is compared instant by instant.
			filters: [{ dimension: 'page', operator: 'eq', value: '/about' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
	})
})
