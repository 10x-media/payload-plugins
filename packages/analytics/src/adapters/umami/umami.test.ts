import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'
import { umami } from './umami'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'visitors', 'visits', 'bounceRate', 'avgDuration'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') },
	...over,
})

describe('umami adapter', () => {
	it('requires a websiteId plus a cloud key or self-host token', () => {
		expect(umami({ websiteId: '' }).isConfigured()).toBe(false)
		expect(umami({ websiteId: 'w', apiKey: 'k' }).isConfigured()).toBe(true)
		expect(umami({ websiteId: 'w', token: 't', host: 'https://a.io/api' }).isConfigured()).toBe(
			true
		)
	})

	it('reads cloud /stats, derives bounceRate, converts totaltime seconds to ms', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', ({ request }) => {
				expect(request.headers.get('x-umami-api-key')).toBe('k')
				const url = new URL(request.url)
				expect(url.searchParams.get('startAt')).toBe(String(Date.UTC(2026, 0, 1)))
				expect(url.searchParams.get('path')).toBe('/pricing')
				return HttpResponse.json({
					pageviews: 1000,
					visitors: 400,
					visits: 500,
					bounces: 250,
					totaltime: 5000,
				})
			})
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(q({ path: '/pricing' }), {})
		expect(result.totals).toEqual({
			pageviews: 1000,
			visitors: 400,
			visits: 500,
			bounceRate: 50,
			avgDuration: 10000,
		})
		expect(result.meta.provider).toBe('umami')
	})

	it('reads a self-hosted host with a bearer token and maps a page breakdown', async () => {
		server.use(
			http.get('https://a.io/api/websites/w/metrics', ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer t')
				expect(new URL(request.url).searchParams.get('type')).toBe('url')
				return HttpResponse.json([
					{ x: '/a', y: 12 },
					{ x: '/b', y: 8 },
				])
			})
		)
		const adapter = umami({ websiteId: 'w', token: 't', host: 'https://a.io/api' })
		const result = await adapter.query(q({ metrics: ['visitors'], dimensions: ['page'] }), {})
		expect(result.rows).toEqual([
			{ dimensions: { page: '/a' }, metrics: { visitors: 12 } },
			{ dimensions: { page: '/b' }, metrics: { visitors: 8 } },
		])
	})

	it('omits derived bounceRate and avgDuration when there are no visits', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', () =>
				HttpResponse.json({ pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 })
			)
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(q(), {})
		expect(result.totals).toEqual({ pageviews: 0, visitors: 0, visits: 0 })
		expect(result.totals?.bounceRate).toBeUndefined()
		expect(result.totals?.avgDuration).toBeUndefined()
	})
})
