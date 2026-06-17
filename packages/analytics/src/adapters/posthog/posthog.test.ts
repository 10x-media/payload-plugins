import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AnalyticsQuery } from '../../core/contract'
import { posthog } from './posthog'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'visitors', 'sessions'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') },
	...over,
})

describe('posthog adapter', () => {
	it('is not configured without a projectId and apiKey', () => {
		expect(posthog({ projectId: '', apiKey: '' }).isConfigured()).toBe(false)
		expect(posthog({ projectId: '123', apiKey: 'phx_k' }).isConfigured()).toBe(true)
	})

	it('posts a HogQL aggregate, bounds the date range, scopes the path, reads totals', async () => {
		let body: { query?: { kind?: string; query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer phx_k')
				body = (await request.json()) as typeof body
				return HttpResponse.json({
					columns: ['m0', 'm1', 'm2'],
					types: ['UInt64', 'UInt64', 'UInt64'],
					results: [[42891, 3102, 8774]],
				})
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ path: '/pricing' }),
			{}
		)
		expect(body.query?.kind).toBe('HogQLQuery')
		const sql = body.query?.query ?? ''
		expect(sql).toContain("event = '$pageview'")
		expect(sql).toContain("timestamp >= toDateTime('2026-01-01 00:00:00')")
		expect(sql).toContain("timestamp <= toDateTime('2026-01-31 00:00:00')")
		expect(sql).toContain("properties.$pathname = '/pricing'")
		expect(sql).toContain('count(DISTINCT person_id)')
		expect(result.totals).toEqual({ pageviews: 42891, visitors: 3102, sessions: 8774 })
		expect(result.meta.provider).toBe('posthog')
	})

	it('dedupes visits + sessions into one distinct-session aggregate', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[500]] })
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['visits', 'sessions'] }),
			{}
		)
		const matches = body.query?.query?.match(/count\(DISTINCT properties\.\$session_id\)/g) ?? []
		expect(matches).toHaveLength(1)
		expect(result.totals).toEqual({ visits: 500, sessions: 500 })
	})

	it('maps a page breakdown to rows (no totals)', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({
					columns: ['path', 'm0'],
					types: ['String', 'UInt64'],
					results: [
						['/', 18043],
						['/pricing', 7412],
					],
				})
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], dimensions: ['page'] }),
			{}
		)
		expect(body.query?.query).toContain('GROUP BY path')
		expect(result.rows).toEqual([
			{ dimensions: { page: '/' }, metrics: { pageviews: 18043 } },
			{ dimensions: { page: '/pricing' }, metrics: { pageviews: 7412 } },
		])
		expect(result.totals).toBeUndefined()
	})

	it('escapes single quotes in the path literal (no HogQL injection)', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[0]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], path: "/x'; DROP" }),
			{}
		)
		expect(body.query?.query).toContain("properties.$pathname = '/x\\'; DROP'")
	})

	it('targets the configured host (EU / self-host)', async () => {
		server.use(
			http.post('https://eu.posthog.com/api/projects/9/query/', () =>
				HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[1]] })
			)
		)
		const result = await posthog({
			projectId: '9',
			apiKey: 'phx_k',
			host: 'https://eu.posthog.com',
		}).query(q({ metrics: ['pageviews'] }), {})
		expect(result.totals?.pageviews).toBe(1)
	})
})
