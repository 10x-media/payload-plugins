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
			filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: '/pricing' } },
		})
		expect(result.totals).toEqual({ pageviews: 48312, visitors: 19847, avgDuration: 143821 })
		expect(result.meta.provider).toBe('ga4')
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
})
