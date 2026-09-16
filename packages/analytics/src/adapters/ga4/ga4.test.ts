import type { protos } from '@google-analytics/data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'

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
	metrics: ['pageviews', 'visitors', 'avgDuration'],
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
		expect(result.totals).toEqual({ pageviews: 48312, visitors: 19847, avgDuration: 143821 })
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

	it('declares filters as the mapped dimensions except goal, with every contract operator', () => {
		const caps = ga4(config).capabilities
		expect(caps.filters).toEqual(
			new Set([...caps.dimensions].filter((dimension) => dimension !== 'goal'))
		)
		expect(caps.filterOperators).toEqual(new Set(['eq', 'contains', 'matches']))
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
			expect(caps.filters.has('goal')).toBe(false)
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
		const scripts = capture?.snippet({ path: '/api/analytics/p/global' }).scripts ?? []
		// Inline first: `gtag` and its queue exist before the tag lands, and survive a tag that
		// never lands at all.
		expect(scripts[0]?.inline).toBe(
			'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-AB12CD34")'
		)
		expect(scripts[1]).toEqual({
			src: 'https://www.googletagmanager.com/gtag/js?id=G-AB12CD34',
			async: true,
		})
	})

	// The id reaches an inline script and a URL, so anything that is not a bare token is
	// refused outright rather than escaped into either.
	it('declares no capture for an id carrying anything but letters, digits and dashes', () => {
		for (const measurementId of ['G-AB"12', 'G AB12', 'G-AB12</script>', 'G-AB12&x=1']) {
			expect(ga4({ ...config, measurementId }).capture).toBeUndefined()
		}
	})
})
