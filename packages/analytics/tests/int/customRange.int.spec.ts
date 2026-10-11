import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { getRuntime } from '../../src/plugin/runtime'
import { resolveCustomRange } from '../../src/widgets/range'
import { readForWidget } from '../../src/widgets/readForWidget'
import { callEndpoint } from './endpointHelpers'
import { storeEvents } from './nativeHelpers'
import { readerRequest } from './readerRequest'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const TZ = 'Europe/Berlin'

type ErrorBody = { error: { code: string; message: string; param?: string } }
type DocumentBody = { metrics: { pageviews?: number } }

// Jun 23 in Berlin runs 2026-06-22T22:00Z .. 2026-06-23T21:59:59.999Z, so the two evening
// events straddle the final day the picker shows as included.
const LAST_DAY_EVENING = '2026-06-23T21:30:00.000Z'
const NEXT_DAY_EARLY = '2026-06-23T22:30:00.000Z'
const FIRST_DAY = '2026-06-01T06:00:00.000Z'

// What the dayOnly picker stores for an admin sitting in Berlin who picks Jun 1 .. Jun 23.
const BERLIN_ADMIN_PICK = { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' }

const pageview = (timestamp: string, visitorId: string): NormalizedEvent => ({
	timestamp: new Date(timestamp),
	type: 'pageview',
	path: '/about',
	hostname: 'example.com',
	visitorId,
})

describeForDb('custom ranges in the reporting timezone', {}, (db) => {
	let booted: BootedPayload
	let pageId: string
	const fakeUser = { id: 'test-user', collection: 'users' }

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				// Every raw hit read, however old: the fixture's days are further back than the default 90.
				adapters: [native({ retention: { rawDays: null } })],
				capture: { gate: 'off' },
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
		await storeEvents(booted.payload, [
			pageview(FIRST_DAY, 'a'),
			pageview(LAST_DAY_EVENING, 'b'),
			pageview(NEXT_DAY_EARLY, 'c'),
		])
	})

	afterAll(async () => {
		await booted.stop()
	})

	/** The document endpoint's pageviews of the About page over a custom `from`..`to`. */
	const readRange = (from: string, to: string): Promise<Response> =>
		callEndpoint(booted.payload, {
			path: routes.document,
			query: `collection=pages&id=${pageId}&metrics=pageviews&timeframe=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
			user: fakeUser,
		})

	const pageviewsOf = async (res: Response): Promise<number | undefined> =>
		((await res.json()) as DocumentBody).metrics.pageviews

	it(`reads day bounds inclusively in the reporting timezone on ${db}`, async () => {
		const res = await readRange('2026-06-01', '2026-06-23')
		expect(res.status).toBe(200)
		const body = (await res.json()) as DocumentBody & {
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
		const withOffset = await readRange('2026-06-01T00:00:00+02:00', '2026-06-23T23:59:59+02:00')
		expect(withOffset.status).toBe(200)
		expect(await pageviewsOf(withOffset)).toBe(2)

		const naive = await readRange('2026-06-01T00:00:00', '2026-06-23T23:59:59')
		expect(naive.status).toBe(400)
		expect(((await naive.json()) as ErrorBody).error).toMatchObject({
			code: 'invalid_param',
			param: 'from',
		})
	})

	it(`accepts a single-day window and rejects an inverted one on ${db}`, async () => {
		const oneDay = await readRange('2026-06-23', '2026-06-23')
		expect(oneDay.status).toBe(200)
		expect(await pageviewsOf(oneDay)).toBe(1)

		const inverted = await readRange('2026-06-23', '2026-06-01')
		expect(inverted.status).toBe(400)
	})

	it(`rejects two equal instants as a zero-width window on ${db}`, async () => {
		const res = await readRange('2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z')
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error).toMatchObject({
			code: 'invalid_param',
			param: 'to',
		})
	})

	it(`leaves a picked range out of what the warm task keeps warm on ${db}`, async () => {
		const runtime = getRuntime(booted.payload)
		const store = runtime?.cache?.store
		if (!store) {
			throw new Error('runtime read cache missing after boot')
		}
		const read = await readForWidget({
			req: readerRequest(booted.payload),
			metrics: ['visitors'],
			timeframe: 'last30days',
			now: new Date(),
			range: resolveCustomRange('custom', BERLIN_ADMIN_PICK, TZ),
			timezone: TZ,
		})
		expect(read.status).toBe('ok')
		// A picked window is the same days tomorrow: there is no today's key to keep warm. The answer
		// is written in the background, so the store is asked once that write landed.
		await runtime?.engine.idle?.()
		const recipes = await store.recentRecipes(new Date(Date.now() - 3_600_000), 50)
		expect(recipes.filter((recipe) => recipe.query.metrics.includes('visitors'))).toEqual([])
	})

	it(`widget reads cover the whole final day the admin picked on ${db}`, async () => {
		const range = resolveCustomRange('custom', BERLIN_ADMIN_PICK, TZ)
		expect(range?.end.toISOString()).toBe('2026-06-23T21:59:59.999Z')
		const result = await readForWidget({
			req: readerRequest(booted.payload),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
			range,
			timezone: TZ,
			// A `contains` filter routes the native adapter through raw hits rather than the days'
			// aggregate rows, where the end bound is compared instant by instant.
			filters: [{ dimension: 'page', operator: 'contains', value: '/about' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
	})
})
