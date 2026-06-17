import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'
import { plausible } from './plausible'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'visitors', 'avgDuration'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T23:59:59Z') },
	...over,
})

describe('plausible adapter', () => {
	it('is not configured without a siteId and apiKey', () => {
		expect(plausible({ siteId: '', apiKey: '' }).isConfigured()).toBe(false)
		expect(plausible({ siteId: 's', apiKey: 'k' }).isConfigured()).toBe(true)
	})

	it('sends a v2 query and normalizes totals, converting visit_duration seconds to ms', async () => {
		let captured: {
			site_id?: string
			metrics?: string[]
			filters?: unknown
			date_range?: string[]
		} = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer k')
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({
					results: [{ metrics: [120, 80, 42], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		const result = await adapter.query(q({ path: '/pricing' }), {})
		expect(captured.site_id).toBe('example.com')
		expect(captured.metrics).toEqual(['pageviews', 'visitors', 'visit_duration'])
		expect(captured.filters).toEqual([['is', 'event:page', ['/pricing']]])
		expect(captured.date_range).toEqual(['2026-01-01', '2026-01-31'])
		expect(result.totals).toEqual({ pageviews: 120, visitors: 80, avgDuration: 42000 })
		expect(result.meta.provider).toBe('plausible')
	})

	it('maps a page-dimension breakdown to rows', async () => {
		server.use(
			http.post('https://plausible.io/api/v2/query', () =>
				HttpResponse.json({
					results: [
						{ metrics: [50], dimensions: ['/a'] },
						{ metrics: [30], dimensions: ['/b'] },
					],
					meta: {},
					query: {},
				})
			)
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		const result = await adapter.query(q({ metrics: ['pageviews'], dimensions: ['page'] }), {})
		expect(result.rows).toEqual([
			{ dimensions: { page: '/a' }, metrics: { pageviews: 50 } },
			{ dimensions: { page: '/b' }, metrics: { pageviews: 30 } },
		])
	})

	it('targets a self-hosted host when provided', async () => {
		server.use(
			http.post('https://plausible.acme.io/api/v2/query', () =>
				HttpResponse.json({ results: [{ metrics: [1], dimensions: [] }], meta: {}, query: {} })
			)
		)
		const adapter = plausible({ siteId: 's', apiKey: 'k', host: 'https://plausible.acme.io' })
		const result = await adapter.query(q({ metrics: ['pageviews'] }), {})
		expect(result.totals?.pageviews).toBe(1)
	})
})
