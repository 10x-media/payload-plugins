import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { DimensionKey } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { isRawDimension } from '../../src/native/store/rawRead'
import { calendarDayOf } from '../../src/timeframe/calendar'
import { ingestRequest } from './ingestRequest'
import { aroundNow, nativeOf, storedHits } from './nativeHelpers'

const CHROME_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const FIREFOX_WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'

const CAMPAIGN_QUERY =
	'utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_content=hero&utm_term=shoes'

/** Dimensions under test, with the value each fixture ingest should report. */
const ADDED: ReadonlyArray<readonly [DimensionKey, string]> = [
	['referrer', 'example.org'],
	['channel', 'email'],
	['region', 'CA'],
	['city', 'San Francisco'],
	['browser', 'chrome'],
	['os', 'macos'],
	['language', 'de-de'],
	['utmSource', 'newsletter'],
	['utmMedium', 'email'],
	['utmCampaign', 'spring'],
	['utmContent', 'hero'],
	['utmTerm', 'shoes'],
]

type IngestHandler = (req: PayloadRequest) => Promise<Response>

const ingestHandler = (booted: BootedPayload): IngestHandler => {
	const endpoint = (booted.payload.config.endpoints ?? []).find(
		(e): e is Endpoint => typeof e === 'object' && e.path === '/_x/e'
	)
	if (!endpoint || typeof endpoint.handler !== 'function') {
		throw new Error('ingest endpoint not registered')
	}
	return endpoint.handler as IngestHandler
}

describeForDb('native dimensions: ingest to breakdowns', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	const ingest = async (
		body: Record<string, unknown>,
		headers: Record<string, string>
	): Promise<void> => {
		const res = await ingestHandler(booted)(
			// The hostname is the request's own host: the self-referral check below reads it.
			ingestRequest(booted.payload, body, { host: 'site.com', ...headers })
		)
		expect(res.status).toBe(202)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			// The fixtures carry Vercel's location headers, which only a Vercel install reads.
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				trustedPlatform: 'vercel',
			}),
			db,
		})
		// Two campaign visitors from a www referrer on Chrome/macOS, one plain Firefox/Windows
		// visitor with nothing but a user agent, and one server event that knows none of it.
		for (const visitor of ['visitor-a', 'visitor-b']) {
			await ingest(
				{
					type: 'pageview',
					path: '/pricing',
					referrer: 'https://www.example.org/path?x=1',
					query: CAMPAIGN_QUERY,
					durationMs: 100,
				},
				{
					'user-agent': `${CHROME_MAC} ${visitor}`,
					'accept-language': 'de-DE,de;q=0.9',
					'x-vercel-ip-country': 'US',
					'x-vercel-ip-country-region': 'CA',
					'x-vercel-ip-city': 'San Francisco',
				}
			)
		}
		await ingest(
			{ type: 'pageview', path: '/pricing', durationMs: 100 },
			{ 'user-agent': FIREFOX_WINDOWS }
		)
		await adapter.ingest?.track?.(
			booted.payload,
			{ type: 'event', name: 'invoice_paid', path: '/hook', hostname: 'site.com' },
			{ flush: true }
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	const breakdown = async (
		dimension: DimensionKey,
		extra: Record<string, unknown> = {}
	): Promise<Record<string, number>> => {
		const result = await adapter.query(
			{ metrics: ['pageviews'], dimensions: [dimension], dateRange: aroundNow(), ...extra },
			{ payload: booted.payload }
		)
		return Object.fromEntries(
			result.rows.map((row) => [row.dimensions?.[dimension], row.metrics.pageviews ?? 0])
		)
	}

	it('serves a breakdown row per new dimension, from the values ingest derived', async () => {
		for (const [dimension, value] of ADDED) {
			expect(await breakdown(dimension)).toMatchObject({ [value]: 2 })
		}
	})

	it('reports the referrer bucket as the bare host, without scheme, path or www', async () => {
		const rows = await breakdown('referrer')
		expect(Object.keys(rows)).toEqual(['example.org'])
	})

	it('omits a dimension the event never carried', async () => {
		// The Firefox visitor sent no referrer, no campaign and no accept-language, and the
		// server event abstains from the user-agent dimensions entirely.
		expect(await breakdown('browser')).toEqual({ chrome: 2, firefox: 1 })
		expect(await breakdown('os')).toEqual({ macos: 2, windows: 1 })
		expect(Object.keys(await breakdown('language'))).toEqual(['de-de'])
	})

	it("serves the same breakdown from the day's aggregate rows as from its raw hits", async () => {
		const { engine, store } = nativeOf(booted.payload)
		const [first] = await storedHits(booted.payload)
		const day = calendarDayOf(new Date(String(first?.ts)), 'UTC')
		expect(await engine.snapshot({ scope: '', day, tz: 'UTC' })).toMatchObject({
			outcome: 'completed',
		})
		for (const [dimension] of ADDED) {
			if (!isRawDimension(dimension)) {
				throw new Error(`${dimension} is a dimension the engine aggregates`)
			}
			const raw = await breakdown(dimension)
			const rows = await store.readAggregates({
				days: [[day, day]],
				dim: dimension,
				groupBy: 'value',
			})
			const aggregated = Object.fromEntries(
				rows.flatMap((row) => (row.value ? [[row.value, row.parts.pageviews ?? 0]] : []))
			)
			expect(aggregated, dimension).toEqual(raw)
		}
	})

	it('filters with eq on every new dimension', async () => {
		for (const [dimension, value] of ADDED) {
			const result = await adapter.query(
				{
					metrics: ['pageviews', 'visitors'],
					dateRange: aroundNow(),
					filters: [{ dimension, operator: 'eq', value }],
				},
				{ payload: booted.payload }
			)
			expect(result.totals).toEqual({ pageviews: 2, visitors: 2 })
		}
	})

	it('filters with contains on every new dimension', async () => {
		for (const [dimension, value] of ADDED) {
			const result = await adapter.query(
				{
					metrics: ['pageviews'],
					dateRange: aroundNow(),
					filters: [{ dimension, operator: 'contains', value: value.slice(0, 3) }],
				},
				{ payload: booted.payload }
			)
			expect(result.totals).toEqual({ pageviews: 2 })
		}
	})

	it('emits no referrer bucket for internal navigation', async () => {
		await ingest(
			{ type: 'pageview', path: '/internal', referrer: 'https://www.site.com/pricing' },
			{ 'user-agent': `${CHROME_MAC} internal` }
		)
		expect(Object.keys(await breakdown('referrer'))).toEqual(['example.org'])
		// `source` names the origin, so the campaign visitors report their `utm_source`; the
		// plain visitor and this internal hop have none and read as direct.
		expect(await breakdown('source')).toMatchObject({ direct: 2, newsletter: 2 })
		// The same two visitors' `utm_medium` is email, which outranks their referrer host.
		expect(await breakdown('channel')).toMatchObject({ direct: 2, email: 2 })
	})

	it('answers 202 and stores no referrer for a body whose referrer is not a string', async () => {
		await ingest(
			{ type: 'pageview', path: '/hostile', referrer: {} },
			{ 'user-agent': `${CHROME_MAC} hostile` }
		)
		const docs = await storedHits(booted.payload, { path: { equals: '/hostile' } })
		expect(docs).toHaveLength(1)
		expect(docs[0]?.ref ?? null).toBeNull()
		expect(docs[0]).not.toHaveProperty('referrer')
	})

	it('narrows a breakdown by a filter on another new dimension', async () => {
		const result = await adapter.query(
			{
				metrics: ['pageviews'],
				dimensions: ['browser'],
				dateRange: aroundNow(),
				filters: [{ dimension: 'utmCampaign', operator: 'eq', value: 'spring' }],
			},
			{ payload: booted.payload }
		)
		expect(result.rows.map((row) => row.dimensions?.browser)).toEqual(['chrome'])
	})
})

describeForDb('native dimensions: scope isolation', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	const ingest = async (tenant: string, ua: string): Promise<void> => {
		const res = await ingestHandler(booted)(
			ingestRequest(
				booted.payload,
				{ type: 'pageview', path: '/scoped', hostname: 'site.com', durationMs: 100 },
				{ 'user-agent': ua, 'x-tenant': tenant }
			)
		)
		expect(res.status).toBe(202)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
			}),
			db,
		})
		await ingest('t1', CHROME_MAC)
		await ingest('t2', FIREFOX_WINDOWS)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it("keeps one tenant's browser breakdown out of the other's", async () => {
		const forScope = async (scope: string): Promise<string[]> => {
			const result = await adapter.query(
				{ metrics: ['pageviews'], dimensions: ['browser'], dateRange: aroundNow(), scope },
				{ payload: booted.payload }
			)
			return result.rows.map((row) => row.dimensions?.browser ?? '')
		}
		expect(await forScope('t1')).toEqual(['chrome'])
		expect(await forScope('t2')).toEqual(['firefox'])
	})
})
