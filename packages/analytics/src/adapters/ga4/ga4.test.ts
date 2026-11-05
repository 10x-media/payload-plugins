import type { protos } from '@google-analytics/data'
import type { Config, Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filterableDimensions, filterOperatorsFor, metricReaches } from '../../core/capabilities'
import type { AdapterRegisterContext, AnalyticsQuery } from '../../core/contract'
import type { Ga4Sdk } from '../../core/sdks'
import { GA4_SDK_WARNING } from '../../plugin/peers'
import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'
import { GA4_DISABLE_PREFIX } from './disableKey'

const { runReport } = vi.hoisted(() => ({ runReport: vi.fn() }))

vi.mock('@google-analytics/data', () => ({
	BetaAnalyticsDataClient: class {
		runReport = runReport
	},
}))

import { ga4 } from './ga4'

type RunReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest

const config = {
	propertyId: '123456789',
	credentials: { client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'pk' },
}

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'visitors', 'visitDuration'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T23:59:59Z') },
	...over,
})

const sentRequest = (): RunReportRequest => runReport.mock.calls[0]?.[0] as RunReportRequest

beforeEach(() => {
	runReport.mockReset()
})

describe('ga4 adapter', () => {
	it('defaults maxLookbackDays to 425 and allows overriding to null', () => {
		expect(ga4(config).capabilities.maxLookbackDays).toBe(425)
		expect(ga4({ ...config, maxLookbackDays: null }).capabilities.maxLookbackDays).toBeNull()
	})

	it('is not configured without a propertyId and credentials', () => {
		expect(
			ga4({ propertyId: '', credentials: { client_email: '', private_key: '' } }).isConfigured()
		).toBe(false)
		expect(ga4(config).isConfigured()).toBe(true)
	})

	it('runs a report and normalizes totals, ratio->percent and seconds->ms', async () => {
		runReport.mockResolvedValue([
			{
				dimensionHeaders: [],
				metricHeaders: [
					{ name: 'screenPageViews', type: 'TYPE_INTEGER' },
					{ name: 'totalUsers', type: 'TYPE_INTEGER' },
					{ name: 'averageSessionDuration', type: 'TYPE_SECONDS' },
				],
				rows: [
					{
						dimensionValues: [],
						metricValues: [{ value: '48312' }, { value: '19847' }, { value: '143.821' }],
					},
				],
				rowCount: 1,
			},
		])
		const result = await ga4(config).query(q({ path: '/pricing' }), {})
		const req = sentRequest()
		expect(req.property).toBe('properties/123456789')
		expect(req.metrics).toEqual([
			{ name: 'screenPageViews' },
			{ name: 'totalUsers' },
			{ name: 'averageSessionDuration' },
		])
		expect(req.dateRanges).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-31' }])
		expect(req.dimensionFilter).toEqual({
			filter: {
				fieldName: 'pagePath',
				stringFilter: { matchType: 'EXACT', value: '/pricing', caseSensitive: true },
			},
		})
		expect(result.totals).toEqual({ pageviews: 48312, visitors: 19847, visitDuration: 143821 })
		expect(result.meta.provider).toBe('ga4')
	})

	it('combines path and hostname into an andGroup dimension filter', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		await ga4(config).query(
			q({ metrics: ['pageviews'], path: '/pricing', hostname: 'a.example.com' }),
			{}
		)
		expect(sentRequest().dimensionFilter).toEqual({
			andGroup: {
				expressions: [
					{
						filter: {
							fieldName: 'pagePath',
							stringFilter: { matchType: 'EXACT', value: '/pricing', caseSensitive: true },
						},
					},
					{
						filter: {
							fieldName: 'hostName',
							stringFilter: { matchType: 'EXACT', value: 'a.example.com', caseSensitive: true },
						},
					},
				],
			},
		})
	})

	it('filters by hostname alone as a single dimension filter', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		await ga4(config).query(q({ metrics: ['pageviews'], hostname: 'a.example.com' }), {})
		expect(sentRequest().dimensionFilter).toEqual({
			filter: {
				fieldName: 'hostName',
				stringFilter: { matchType: 'EXACT', value: 'a.example.com', caseSensitive: true },
			},
		})
	})

	it('declares filters as the mapped dimensions except goal, each with every contract operator', () => {
		const caps = ga4(config).capabilities
		expect(filterableDimensions(caps).sort()).toEqual(
			[...caps.dimensions].filter((dimension) => dimension !== 'goal').sort()
		)
		for (const dimension of filterableDimensions(caps)) {
			expect(filterOperatorsFor(caps, dimension)).toEqual(['eq', 'contains', 'matches'])
		}
	})

	it.each([
		['eq' as const, 'EXACT', true],
		['contains' as const, 'CONTAINS', false],
		['matches' as const, 'FULL_REGEXP', true],
	])('sends a %s filter as a %s stringFilter with caseSensitive %s', async (operator, matchType, caseSensitive) => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		await ga4(config).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'country', operator, value: 'DE' }],
			}),
			{}
		)
		expect(sentRequest().dimensionFilter).toEqual({
			filter: {
				fieldName: 'countryId',
				stringFilter: { matchType, value: 'DE', caseSensitive },
			},
		})
	})

	it('combines the path filter and an eq filter into an andGroup', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		await ga4(config).query(
			q({
				metrics: ['pageviews'],
				path: '/pricing',
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			}),
			{}
		)
		expect(sentRequest().dimensionFilter).toEqual({
			andGroup: {
				expressions: [
					{
						filter: {
							fieldName: 'pagePath',
							stringFilter: { matchType: 'EXACT', value: '/pricing', caseSensitive: true },
						},
					},
					{
						filter: {
							fieldName: 'countryId',
							stringFilter: { matchType: 'EXACT', value: 'DE', caseSensitive: true },
						},
					},
				],
			},
		})
	})

	it('drops a filter for an unmapped dimension', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		await ga4(config).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'goal', operator: 'eq', value: 'signup' }],
			}),
			{}
		)
		expect(sentRequest().dimensionFilter).toBeUndefined()
	})

	it('converts the bounceRate ratio to a percentage', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'bounceRate', type: 'TYPE_FLOAT' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '0.3847' }] }],
			},
		])
		const result = await ga4(config).query(q({ metrics: ['bounceRate'] }), {})
		expect(result.totals).toEqual({ bounceRate: 38 })
	})

	it('dedupes aliased metrics (visits + sessions -> one GA4 "sessions")', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '500' }] }],
			},
		])
		const result = await ga4(config).query(q({ metrics: ['visits', 'sessions'] }), {})
		expect(sentRequest().metrics).toEqual([{ name: 'sessions' }])
		expect(result.totals).toEqual({ visits: 500, sessions: 500 })
	})

	it('maps a page-dimension breakdown to rows (no totals)', async () => {
		runReport.mockResolvedValue([
			{
				dimensionHeaders: [{ name: 'pagePath' }],
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [
					{ dimensionValues: [{ value: '/' }], metricValues: [{ value: '15204' }] },
					{ dimensionValues: [{ value: '/pricing' }], metricValues: [{ value: '5937' }] },
				],
				rowCount: 2,
			},
		])
		const result = await ga4(config).query(q({ metrics: ['pageviews'], dimensions: ['page'] }), {})
		expect(sentRequest().dimensions).toEqual([{ name: 'pagePath' }])
		expect(result.rows).toEqual([
			{ dimensions: { page: '/' }, metrics: { pageviews: 15204 } },
			{ dimensions: { page: '/pricing' }, metrics: { pageviews: 5937 } },
		])
		expect(result.totals).toBeUndefined()
	})

	it('maps the country dimension to GA4 countryId (ISO code)', async () => {
		runReport.mockResolvedValue([
			{
				dimensionHeaders: [{ name: 'countryId' }],
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [{ value: 'DE' }], metricValues: [{ value: '12' }] }],
				rowCount: 1,
			},
		])
		const result = await ga4(config).query(
			q({ metrics: ['pageviews'], dimensions: ['country'] }),
			{}
		)
		expect(sentRequest().dimensions).toEqual([{ name: 'countryId' }])
		expect(result.rows).toEqual([{ dimensions: { country: 'DE' }, metrics: { pageviews: 12 } }])
	})

	it('maps the channel dimension to sessionDefaultChannelGroup', async () => {
		runReport.mockResolvedValue([
			{
				dimensionHeaders: [{ name: 'sessionDefaultChannelGroup' }],
				metricHeaders: [{ name: 'totalUsers', type: 'TYPE_INTEGER' }],
				rows: [
					{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '90' }] },
					{ dimensionValues: [{ value: 'Direct' }], metricValues: [{ value: '40' }] },
				],
				rowCount: 2,
			},
		])
		const result = await ga4(config).query(
			q({ metrics: ['visitors'], dimensions: ['channel'] }),
			{}
		)
		expect(sentRequest().dimensions).toEqual([{ name: 'sessionDefaultChannelGroup' }])
		expect(result.rows).toEqual([
			{ dimensions: { channel: 'Organic Search' }, metrics: { visitors: 90 } },
			{ dimensions: { channel: 'Direct' }, metrics: { visitors: 40 } },
		])
	})

	it('groups and filters by channel', async () => {
		runReport.mockResolvedValue([
			{
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
			},
		])
		const caps = ga4(config).capabilities
		expect(caps.dimensions.has('channel')).toBe(true)
		expect(filterOperatorsFor(caps, 'channel')).toContain('eq')
		await ga4(config).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'channel', operator: 'eq', value: 'Paid Social' }],
			}),
			{}
		)
		expect(sentRequest().dimensionFilter).toEqual({
			filter: {
				fieldName: 'sessionDefaultChannelGroup',
				stringFilter: { matchType: 'EXACT', value: 'Paid Social', caseSensitive: true },
			},
		})
	})

	it('returns a per-day series with range totals when granularity is day', async () => {
		runReport.mockResolvedValue([
			{
				dimensionHeaders: [{ name: 'date' }],
				metricHeaders: [{ name: 'screenPageViews', type: 'TYPE_INTEGER' }],
				rows: [
					{ dimensionValues: [{ value: '20260101' }], metricValues: [{ value: '10' }] },
					{ dimensionValues: [{ value: '20260102' }], metricValues: [{ value: '25' }] },
				],
				totals: [
					{ dimensionValues: [{ value: 'RESERVED_TOTAL' }], metricValues: [{ value: '35' }] },
				],
				rowCount: 2,
			},
		])
		const result = await ga4(config).query(q({ metrics: ['pageviews'], granularity: 'day' }), {})
		const req = sentRequest()
		expect(req.dimensions).toEqual([{ name: 'date' }])
		expect(req.metricAggregations).toEqual(['TOTAL'])
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 10 } },
			{ timestamp: '2026-01-02T00:00:00.000Z', metrics: { pageviews: 25 } },
		])
		expect(result.totals).toEqual({ pageviews: 35 })
		expect(runReport).toHaveBeenCalledTimes(1)
	})

	it('formats both range bounds as calendar days in the reporting timezone', async () => {
		runReport.mockResolvedValue([{ dimensionHeaders: [], metricHeaders: [], rows: [] }])
		await ga4(config).query(
			q({
				timezone: 'America/New_York',
				dateRange: {
					start: new Date('2026-09-01T04:00:00.000Z'),
					end: new Date('2026-09-08T03:59:59.999Z'),
				},
			}),
			{}
		)
		expect(sentRequest().dateRanges).toEqual([{ startDate: '2026-09-01', endDate: '2026-09-07' }])
	})

	it('does not roll the start bound back a day for zones east of UTC', async () => {
		runReport.mockResolvedValue([{ dimensionHeaders: [], metricHeaders: [], rows: [] }])
		await ga4(config).query(
			q({
				timezone: 'Europe/Berlin',
				dateRange: {
					start: new Date('2026-08-31T22:00:00.000Z'),
					end: new Date('2026-09-07T21:59:59.999Z'),
				},
			}),
			{}
		)
		expect(sentRequest().dateRanges).toEqual([{ startDate: '2026-09-01', endDate: '2026-09-07' }])
	})

	describe('goals and conversions', () => {
		const GOAL_FILTER = {
			filter: {
				fieldName: 'eventName',
				inListFilter: { values: ['signup', 'purchase'], caseSensitive: true },
			},
		}

		/** Answers a request with the rows its metric list asks for; key events come goal-filtered. */
		const respond = (rowsFor: (metrics: string[]) => unknown[]): void => {
			runReport.mockImplementation((request: RunReportRequest) => [
				{ rows: rowsFor((request.metrics ?? []).map((m) => m.name ?? '')) },
			])
		}

		const requests = (): RunReportRequest[] =>
			runReport.mock.calls.map((call) => call[0] as RunReportRequest)

		it('declares the goal dimension and conversions, and does not offer goal as a filter', () => {
			const caps = ga4(config).capabilities
			expect(caps.dimensions.has('goal')).toBe(true)
			expect(caps.metrics.has('conversions')).toBe(true)
			expect(filterOperatorsFor(caps, 'goal')).toEqual([])
		})

		it('breaks eventName down, in-list filtered to the hint, reading keyEvents as conversions', async () => {
			respond(() => [
				{ dimensionValues: [{ value: 'signup' }], metricValues: [{ value: '9' }] },
				{ dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '2' }] },
			])
			const result = await ga4(config).query(
				q({
					metrics: ['conversions'],
					dimensions: ['goal'],
					goalSlugs: ['signup', 'purchase'],
				}),
				{}
			)
			const sent = requests()[0]
			expect(sent?.dimensions).toEqual([{ name: 'eventName' }])
			expect(sent?.metrics).toEqual([{ name: 'keyEvents' }])
			expect(sent?.dimensionFilter).toEqual(GOAL_FILTER)
			expect(result.rows).toEqual([
				{ dimensions: { goal: 'signup' }, metrics: { conversions: 9 } },
				{ dimensions: { goal: 'purchase' }, metrics: { conversions: 2 } },
			])
		})

		it('serves no goal rows and says so when the read carries no hint', async () => {
			const result = await ga4(config).query(
				q({ metrics: ['conversions'], dimensions: ['goal'] }),
				{}
			)
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBe(true)
			expect(runReport).not.toHaveBeenCalled()
		})

		it('says so when the goal resolver failed', async () => {
			const result = await ga4(config).query(
				q({ metrics: ['conversions'], dimensions: ['goal'], goalSlugs: 'unresolved' }),
				{}
			)
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBe(true)
			expect(runReport).not.toHaveBeenCalled()
		})

		// A property with no goals configured has an empty goal table, not a broken one.
		it('serves an empty goal breakdown unflagged when the scope configures no goals', async () => {
			const result = await ga4(config).query(
				q({ metrics: ['conversions'], dimensions: ['goal'], goalSlugs: [] }),
				{}
			)
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBeUndefined()
			expect(runReport).not.toHaveBeenCalled()
		})

		it('reads conversions beside site metrics from a second, in-list filtered report', async () => {
			respond((metrics) =>
				metrics.includes('keyEvents')
					? [{ dimensionValues: [], metricValues: [{ value: '11' }] }]
					: [{ dimensionValues: [], metricValues: [{ value: '500' }] }]
			)
			const result = await ga4(config).query(
				q({ metrics: ['pageviews', 'conversions'], goalSlugs: ['signup', 'purchase'] }),
				{}
			)
			const [site, goals] = requests()
			expect(site?.metrics).toEqual([{ name: 'screenPageViews' }])
			expect(site?.dimensionFilter).toBeUndefined()
			expect(goals?.metrics).toEqual([{ name: 'keyEvents' }])
			expect(goals?.dimensionFilter).toEqual(GOAL_FILTER)
			expect(result.totals).toEqual({ pageviews: 500, conversions: 11 })
		})

		it('ands the goal hint onto the page filter', async () => {
			respond(() => [{ dimensionValues: [], metricValues: [{ value: '1' }] }])
			await ga4(config).query(
				q({ metrics: ['conversions'], path: '/pricing', goalSlugs: ['signup', 'purchase'] }),
				{}
			)
			expect(requests()[0]?.dimensionFilter).toEqual({
				andGroup: {
					expressions: [
						{
							filter: {
								fieldName: 'pagePath',
								stringFilter: { matchType: 'EXACT', value: '/pricing', caseSensitive: true },
							},
						},
						GOAL_FILTER,
					],
				},
			})
		})

		it('keeps the site rows and flags the goals when the goal report fails', async () => {
			runReport.mockImplementation((request: RunReportRequest) => {
				if ((request.metrics ?? []).some((m) => m.name === 'keyEvents')) {
					throw new Error('property has no key events')
				}
				return [{ rows: [{ dimensionValues: [], metricValues: [{ value: '500' }] }] }]
			})
			const result = await ga4(config).query(
				q({ metrics: ['pageviews', 'conversions'], goalSlugs: ['signup', 'purchase'] }),
				{}
			)
			expect(requests()).toHaveLength(2)
			expect(result.totals).toEqual({ pageviews: 500 })
			expect(result.meta.goalsUnresolved).toBe(true)
		})

		it('fails the read when the goal report is the only report it runs', async () => {
			runReport.mockImplementation(() => {
				throw new Error('property has no key events')
			})
			await expect(
				ga4(config).query(q({ metrics: ['conversions'], goalSlugs: ['signup'] }), {})
			).rejects.toThrow('property has no key events')
		})

		it('unions a breakdown: a goal-only row is appended, a site-only row keeps no conversions', async () => {
			respond((metrics) =>
				metrics.includes('keyEvents')
					? [
							{ dimensionValues: [{ value: '/pricing' }], metricValues: [{ value: '4' }] },
							{ dimensionValues: [{ value: '/thanks' }], metricValues: [{ value: '1' }] },
						]
					: [
							{ dimensionValues: [{ value: '/pricing' }], metricValues: [{ value: '90' }] },
							{ dimensionValues: [{ value: '/blog' }], metricValues: [{ value: '30' }] },
						]
			)
			const result = await ga4(config).query(
				q({
					metrics: ['pageviews', 'conversions'],
					dimensions: ['page'],
					limit: 2,
					goalSlugs: ['signup', 'purchase'],
				}),
				{}
			)
			const [site, goals] = requests()
			expect(site?.limit).toBe(2)
			// The goal report answers a different ranking, so the read's own limit would cut
			// goals the union still needs.
			expect(goals?.limit).toBeUndefined()
			expect(result.rows).toEqual([
				{ dimensions: { page: '/pricing' }, metrics: { pageviews: 90, conversions: 4 } },
				{ dimensions: { page: '/blog' }, metrics: { pageviews: 30 } },
				{ dimensions: { page: '/thanks' }, metrics: { conversions: 1 } },
			])
		})

		it('attaches the conversions of a channel breakdown to the channel rows they belong to', async () => {
			respond((metrics) =>
				metrics.includes('keyEvents')
					? [
							{ dimensionValues: [{ value: 'Paid Search' }], metricValues: [{ value: '4' }] },
							{ dimensionValues: [{ value: 'Email' }], metricValues: [{ value: '1' }] },
						]
					: [
							{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '90' }] },
							{ dimensionValues: [{ value: 'Paid Search' }], metricValues: [{ value: '30' }] },
						]
			)
			const result = await ga4(config).query(
				q({
					metrics: ['pageviews', 'conversions'],
					dimensions: ['channel'],
					goalSlugs: ['signup'],
				}),
				{}
			)
			const [site, goals] = requests()
			expect(site?.dimensions).toEqual([{ name: 'sessionDefaultChannelGroup' }])
			expect(goals?.dimensions).toEqual([{ name: 'sessionDefaultChannelGroup' }])
			expect(result.rows).toEqual([
				{ dimensions: { channel: 'Organic Search' }, metrics: { pageviews: 90 } },
				{ dimensions: { channel: 'Paid Search' }, metrics: { pageviews: 30, conversions: 4 } },
				{ dimensions: { channel: 'Email' }, metrics: { conversions: 1 } },
			])
		})

		it('asks for the GA4 event names its slugs normalize to, and maps the rows back', async () => {
			respond(() => [
				{ dimensionValues: [{ value: 'checkout_complete' }], metricValues: [{ value: '7' }] },
			])
			const result = await ga4(config).query(
				q({
					metrics: ['conversions'],
					dimensions: ['goal'],
					goalSlugs: ['checkout-complete'],
				}),
				{}
			)
			expect(requests()[0]?.dimensionFilter).toEqual({
				filter: {
					fieldName: 'eventName',
					inListFilter: { values: ['checkout_complete'], caseSensitive: true },
				},
			})
			expect(result.rows).toEqual([
				{ dimensions: { goal: 'checkout-complete' }, metrics: { conversions: 7 } },
			])
		})

		it('gives rows of a shared GA4 event name to the first slug that claims it', async () => {
			respond(() => [{ dimensionValues: [{ value: 'book_demo' }], metricValues: [{ value: '3' }] }])
			const result = await ga4(config).query(
				q({
					metrics: ['conversions'],
					dimensions: ['goal'],
					goalSlugs: ['book-demo', 'book_demo'],
				}),
				{}
			)
			expect(requests()[0]?.dimensionFilter).toEqual({
				filter: {
					fieldName: 'eventName',
					inListFilter: { values: ['book_demo'], caseSensitive: true },
				},
			})
			expect(result.rows).toEqual([
				{ dimensions: { goal: 'book-demo' }, metrics: { conversions: 3 } },
			])
		})

		it('leaves an event breakdown reporting GA4 event names as they are', async () => {
			respond(() => [
				{ dimensionValues: [{ value: 'checkout_complete' }], metricValues: [{ value: '5' }] },
			])
			const result = await ga4(config).query(
				q({ metrics: ['events'], dimensions: ['event'], goalSlugs: ['checkout-complete'] }),
				{}
			)
			expect(result.rows).toEqual([
				{ dimensions: { event: 'checkout_complete' }, metrics: { events: 5 } },
			])
		})

		it('keeps the site metrics and drops conversions when the read carries no hint', async () => {
			respond(() => [{ dimensionValues: [], metricValues: [{ value: '500' }] }])
			const result = await ga4(config).query(q({ metrics: ['pageviews', 'conversions'] }), {})
			expect(requests()).toHaveLength(1)
			expect(requests()[0]?.metrics).toEqual([{ name: 'screenPageViews' }])
			expect(result.totals).toEqual({ pageviews: 500 })
			expect(result.meta.goalsUnresolved).toBe(true)
		})
	})
})

describe('ga4 capture', () => {
	it('declares no capture without a measurementId', () => {
		expect(ga4(config).capture).toBeUndefined()
	})

	it('loads the gtag tag and boots it with the measurement id', () => {
		const capture = ga4({ ...config, measurementId: 'G-AB12CD34' }).capture
		expect(capture?.proxy.routes).toEqual([])
		expect(capture?.client).toEqual({ kind: 'ga4', measurementId: 'G-AB12CD34' })
		const scripts = capture?.snippet({ path: '/api/_x/p/global' }).scripts ?? []
		// Inline first: `gtag` and its queue exist before the tag lands, and survive a tag that
		// never lands at all.
		expect(scripts[0]?.inline).toBe(
			'try{if(localStorage.getItem("analytics:exclude")==="1")window["ga-disable-G-AB12CD34"]=true}catch(e){}window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-AB12CD34")'
		)
		expect(scripts[1]).toEqual({
			src: 'https://www.googletagmanager.com/gtag/js?id=G-AB12CD34',
			async: true,
		})
	})

	it('sets GA4 own disable switch from the stored flag before the first gtag call', () => {
		const inline =
			ga4({ ...config, measurementId: 'G-AB12CD34' }).capture?.snippet({
				path: '/api/_x/p/global',
			}).scripts[0]?.inline ?? ''

		const guardEnd = inline.indexOf('}catch(e){}')
		expect(guardEnd).toBeGreaterThan(-1)
		expect(guardEnd).toBeLessThan(inline.indexOf('gtag('))
		expect(inline.slice(0, guardEnd)).toContain(`getItem("${EXCLUSION_STORAGE_KEY}")`)
		expect(inline.slice(0, guardEnd)).toContain(`window["${GA4_DISABLE_PREFIX}G-AB12CD34"]=true`)
	})

	// The id reaches an inline script and a URL, so anything that is not a bare token is
	// refused outright rather than escaped into either.
	it('declares no capture for an id carrying anything but letters, digits and dashes', () => {
		for (const measurementId of ['G-AB"12', 'G AB12', 'G-AB12</script>', 'G-AB12&x=1']) {
			expect(ga4({ ...config, measurementId }).capture).toBeUndefined()
		}
	})
})

describe('ga4 sdk', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	/** A client class of the shape `@google-analytics/data` exports, recording what it is asked. */
	const sdkWith = () => {
		const reports = vi.fn(async () => [{ rows: [], totals: [] }])
		const built = vi.fn()
		class BetaAnalyticsDataClient {
			constructor(options: unknown) {
				built(options)
			}
			runReport = reports
		}
		return { sdk: { BetaAnalyticsDataClient } as unknown as Ga4Sdk, built, reports }
	}

	const registerWith = (sdks: AdapterRegisterContext['sdks']): AdapterRegisterContext => ({
		scoped: false,
		resolveScope: async () => null,
		resolveTimezone: async () => 'UTC',
		resolveTimezoneStrict: async () => 'UTC',
		revenue: { enabled: true, dimension: true, currency: async () => undefined },
		resolveGoals: async () => [],
		sdks,
	})

	const payloadWith = (warn: (message: string) => void) =>
		({ logger: { warn } }) as unknown as Payload

	it('reads through the sdk it was handed rather than loading the package', async () => {
		const own = sdkWith()
		await ga4({ ...config, sdk: own.sdk }).query(q(), {})
		expect(own.built).toHaveBeenCalledWith({ credentials: config.credentials })
		expect(own.reports).toHaveBeenCalled()
		expect(runReport).not.toHaveBeenCalled()
	})

	it("reads through the plugin's sdks.ga4 when it has none of its own, and prefers its own", async () => {
		const plugin = sdkWith()
		const pluginOnly = ga4(config)
		pluginOnly.register?.({} as Config, registerWith({ ga4: plugin.sdk }))
		await pluginOnly.query(q(), {})
		expect(plugin.reports).toHaveBeenCalledTimes(1)

		const own = sdkWith()
		const both = ga4({ ...config, sdk: own.sdk })
		both.register?.({} as Config, registerWith({ ga4: plugin.sdk }))
		await both.query(q(), {})
		expect(own.reports).toHaveBeenCalledTimes(1)
		expect(plugin.reports).toHaveBeenCalledTimes(1)
		expect(runReport).not.toHaveBeenCalled()
	})

	it('warns once at a production boot when it would load the package at runtime', () => {
		vi.stubEnv('NODE_ENV', 'production')
		const warn = vi.fn()
		const bare = ga4(config)
		bare.register?.({} as Config, registerWith({}))
		bare.attach?.(payloadWith(warn))
		bare.attach?.(payloadWith(warn))
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(GA4_SDK_WARNING)

		const handed = ga4(config)
		handed.register?.({} as Config, registerWith({ ga4: sdkWith().sdk }))
		handed.attach?.(payloadWith(warn))
		ga4({ ...config, sdk: sdkWith().sdk }).attach?.(payloadWith(warn))
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('keeps one client per instance and closes only the closing instance’s', async () => {
		const closes = vi.fn(async () => {})
		const built = vi.fn()
		class BetaAnalyticsDataClient {
			constructor(options: unknown) {
				built(options)
			}
			runReport = vi.fn(async () => [{ rows: [], totals: [] }])
			close = closes
		}
		const adapter = ga4({ ...config, sdk: { BetaAnalyticsDataClient } as unknown as Ga4Sdk })
		const first = payloadWith(vi.fn())
		const second = payloadWith(vi.fn())
		await adapter.query(q(), { payload: first })
		await adapter.query(q(), { payload: first })
		await adapter.query(q(), { payload: second })
		expect(built).toHaveBeenCalledTimes(2)
		await adapter.close?.(first)
		expect(closes).toHaveBeenCalledTimes(1)
		await adapter.close?.(first)
		expect(closes).toHaveBeenCalledTimes(1)
		await adapter.close?.(payloadWith(vi.fn()))
		expect(closes).toHaveBeenCalledTimes(1)
	})

	it('opens no client for an instance it was closed for, until it is attached again', async () => {
		const built = vi.fn()
		class BetaAnalyticsDataClient {
			constructor(options: unknown) {
				built(options)
			}
			runReport = vi.fn(async () => [{ rows: [], totals: [] }])
			close = vi.fn(async () => {})
		}
		const adapter = ga4({ ...config, sdk: { BetaAnalyticsDataClient } as unknown as Ga4Sdk })
		const retired = payloadWith(vi.fn())
		await adapter.query(q(), { payload: retired })
		await adapter.close?.(retired)
		await expect(adapter.query(q(), { payload: retired })).rejects.toThrow('closed')
		expect(built).toHaveBeenCalledTimes(1)
		await adapter.query(q(), { payload: payloadWith(vi.fn()) })
		expect(built).toHaveBeenCalledTimes(2)
		adapter.attach?.(retired)
		await adapter.query(q(), { payload: retired })
		expect(built).toHaveBeenCalledTimes(3)
	})

	it('stays quiet outside production', () => {
		vi.stubEnv('NODE_ENV', 'development')
		const warn = vi.fn()
		ga4(config).attach?.(payloadWith(warn))
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('ga4 reads through the engine', () => {
	const report = (metadata: protos.google.analytics.data.v1beta.IResponseMetaData = {}) => [
		{
			rows: [{ dimensionValues: [], metricValues: [{ value: '500' }] }],
			metadata,
		},
	]

	it('runs each report with no retry of its own and the time the read has left', async () => {
		runReport.mockResolvedValue(report())
		await ga4(config).query(q({ metrics: ['pageviews'] }), { remainingMs: () => 4321.7 })
		expect(runReport.mock.calls[0]?.[1]).toEqual({ timeout: 4321, retry: null })
	})

	it('gives a report a minute outside the engine, which sets no deadline', async () => {
		runReport.mockResolvedValue(report())
		await ga4(config).query(q({ metrics: ['pageviews'] }), {})
		expect(runReport.mock.calls[0]?.[1]).toEqual({ timeout: 60_000, retry: null })
	})

	it('sends each report of a paired read through upstream, one request each', async () => {
		runReport.mockResolvedValue(report())
		let sent = 0
		const upstream = <T>(fn: (signal?: AbortSignal) => Promise<T>): Promise<T> => {
			sent++
			return fn()
		}
		await ga4(config).query(q({ metrics: ['pageviews', 'conversions'], goalSlugs: ['signup'] }), {
			upstream,
		})
		expect(sent).toBe(2)
		expect(runReport).toHaveBeenCalledTimes(2)
		expect(ga4(config).capabilities.upstreamAware).toBe(true)
	})

	it('marks a read sampled when any of its reports was', async () => {
		runReport
			.mockResolvedValueOnce(report())
			.mockResolvedValueOnce(
				report({ samplingMetadatas: [{ samplesReadCount: '1000', samplingSpaceSize: '50000' }] })
			)
		const result = await ga4(config).query(
			q({ metrics: ['pageviews', 'conversions'], goalSlugs: ['signup'] }),
			{}
		)
		expect(result.meta.sampled).toBe(true)
		runReport.mockResolvedValue(report({ samplingMetadatas: [] }))
		const whole = await ga4(config).query(q({ metrics: ['pageviews'] }), {})
		expect(whole.meta.sampled).toBeUndefined()
	})

	it("reports revenue in the property's currency, the configured one only when GA4 names none", async () => {
		runReport.mockResolvedValue(report({ currencyCode: 'jpy' }))
		const named = await ga4({ ...config, currency: 'EUR' }).query(q({ metrics: ['revenue'] }), {})
		expect(named.meta.currency).toBe('JPY')
		runReport.mockResolvedValue(report())
		const configured = await ga4({ ...config, currency: 'eur' }).query(
			q({ metrics: ['revenue'] }),
			{}
		)
		expect(configured.meta.currency).toBe('EUR')
		const unknown = await ga4(config).query(q({ metrics: ['revenue'] }), {})
		expect(unknown.meta.currency).toBeUndefined()
	})

	it('refuses a configured currency that is not an ISO 4217 code, naming the option', () => {
		expect(() => ga4({ ...config, currency: 'euro' })).toThrow(
			'analytics: ga4({ currency }) must be an ISO 4217 currency code such as "EUR", got "euro"'
		)
		expect(() => ga4({ ...config, currency: '  ' })).not.toThrow()
	})

	it('keeps an average GA4 left out as no data rather than 0', async () => {
		runReport.mockResolvedValue([
			{ rows: [{ dimensionValues: [], metricValues: [{ value: '12' }] }], metadata: {} },
		])
		const result = await ga4(config).query(
			q({ metrics: ['pageviews', 'visitDuration', 'avgDuration'] }),
			{}
		)
		expect(result.totals).toEqual({ pageviews: 12, visitDuration: null, avgDuration: null })
	})

	it('reads time on page as engaged seconds over views, per row and for the totals', async () => {
		runReport.mockResolvedValue([
			{
				rows: [
					{
						dimensionValues: [{ value: '/a' }],
						metricValues: [{ value: '30' }, { value: '3' }, { value: '2' }],
					},
					{
						dimensionValues: [{ value: '/b' }],
						metricValues: [{ value: '10' }, { value: '5' }, { value: '0' }],
					},
				],
				metadata: {},
			},
		])
		const result = await ga4(config).query(
			q({ metrics: ['avgDuration', 'pageviews', 'visitors'], dimensions: ['page'] }),
			{}
		)
		expect(sentRequest().metrics).toEqual([
			{ name: 'userEngagementDuration' },
			{ name: 'screenPageViews' },
			{ name: 'totalUsers' },
		])
		expect(result.rows).toEqual([
			{
				dimensions: { page: '/a' },
				metrics: { avgDuration: 10000, pageviews: 3, visitors: 2 },
				samples: { avgDuration: 3 },
			},
			{
				dimensions: { page: '/b' },
				metrics: { avgDuration: 2000, pageviews: 5, visitors: 0 },
				samples: { avgDuration: 5 },
			},
		])
		runReport.mockReset()
		runReport.mockResolvedValue([
			{ rows: [{ dimensionValues: [], metricValues: [{ value: '40' }, { value: '8' }] }] },
		])
		const whole = await ga4(config).query(q({ metrics: ['avgDuration'] }), {})
		expect(whole.totals).toEqual({ avgDuration: 5000 })
	})

	it('declares time on page under every breakdown but an event, and time per visit as its own metric', () => {
		const { capabilities } = ga4(config)
		expect(capabilities.metrics.has('avgDuration')).toBe(true)
		expect(capabilities.metrics.has('visitDuration')).toBe(true)
		expect(metricReaches(capabilities, 'avgDuration', { dimensions: ['page'] })).toBe(true)
		expect(metricReaches(capabilities, 'avgDuration', { dimensions: ['country'] })).toBe(true)
		expect(metricReaches(capabilities, 'avgDuration', { dimensions: ['event'] })).toBe(false)
		expect(metricReaches(capabilities, 'avgDuration', { dimensions: ['goal'] })).toBe(false)
		expect(metricReaches(capabilities, 'visitDuration', { dimensions: ['event'] })).toBe(true)
	})

	it('cancels a call the read gave up on, when the client hands back a cancellable promise', async () => {
		const cancel = vi.fn()
		runReport.mockImplementation(() => Object.assign(new Promise(() => {}), { cancel }))
		const controller = new AbortController()
		void ga4(config).query(q({ metrics: ['pageviews'] }), { signal: controller.signal })
		await vi.waitFor(() => expect(runReport).toHaveBeenCalled())
		expect(cancel).not.toHaveBeenCalled()
		controller.abort(new Error('timed out'))
		expect(cancel).toHaveBeenCalledTimes(1)
	})
})
