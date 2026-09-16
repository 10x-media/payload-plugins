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
	it('defaults maxLookbackDays to 730 and allows overriding to null', () => {
		expect(umami({ websiteId: 'w', apiKey: 'k' }).capabilities.maxLookbackDays).toBe(730)
		expect(
			umami({ websiteId: 'w', apiKey: 'k', maxLookbackDays: null }).capabilities.maxLookbackDays
		).toBeNull()
	})

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
				expect(url.searchParams.get('path')).toBe('eq./pricing')
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

	it('reads a self-hosted host with a bearer token and maps a page breakdown on type=path', async () => {
		server.use(
			http.get('https://a.io/api/websites/w/metrics', ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer t')
				expect(new URL(request.url).searchParams.get('type')).toBe('path')
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

	it('breaks down on the first mapped dimension, using its own umami type', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/metrics', ({ request }) => {
				expect(new URL(request.url).searchParams.get('type')).toBe('browser')
				return HttpResponse.json([{ x: 'chrome', y: 7 }])
			})
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['visitors'], dimensions: ['goal', 'browser'] }),
			{}
		)
		expect(result.rows).toEqual([{ dimensions: { browser: 'chrome' }, metrics: { visitors: 7 } }])
	})

	it('labels a breakdown row with the metric /metrics returns, whatever was asked for', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/metrics', () =>
				HttpResponse.json([{ x: '/a', y: 12 }])
			)
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['pageviews'], dimensions: ['page'] }),
			{}
		)
		expect(result.rows).toEqual([{ dimensions: { page: '/a' }, metrics: { visitors: 12 } }])
	})

	// `event` is not a declared breakdown dimension, so only a direct adapter call reaches this
	// branch; the goals read will.
	it('reports event-breakdown rows as events, since y counts occurrences', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/metrics', ({ request }) => {
				expect(new URL(request.url).searchParams.get('type')).toBe('event')
				return HttpResponse.json([{ x: 'signup', y: 30 }])
			})
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['events'], dimensions: ['event'] }),
			{}
		)
		expect(result.rows).toEqual([{ dimensions: { event: 'signup' }, metrics: { events: 30 } }])
	})

	it('declares every contract operator, and filters by an event it cannot group by', () => {
		const caps = umami({ websiteId: 'w', apiKey: 'k' }).capabilities
		expect(caps.filterOperators).toEqual(new Set(['eq', 'contains', 'matches']))
		expect(caps.filters.has('event')).toBe(true)
		expect(caps.dimensions.has('event')).toBe(false)
		expect([...caps.filters].filter((dimension) => dimension !== 'event')).toEqual([
			...caps.dimensions,
		])
	})

	it.each([
		['eq' as const, 'eq.DE'],
		['contains' as const, 'c.DE'],
		['matches' as const, 're.DE'],
	])('sends a %s filter as the "%s" query value', async (operator, expected) => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', ({ request }) => {
				expect(new URL(request.url).searchParams.get('country')).toBe(expected)
				return HttpResponse.json({
					pageviews: 1,
					visitors: 1,
					visits: 1,
					bounces: 0,
					totaltime: 0,
				})
			})
		)
		await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['pageviews'], filters: [{ dimension: 'country', operator, value: 'DE' }] }),
			{}
		)
	})

	it('carries filters onto the breakdown request and drops an unmapped dimension', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/metrics', ({ request }) => {
				const url = new URL(request.url)
				expect(url.searchParams.get('type')).toBe('path')
				expect(url.searchParams.get('utmSource')).toBe('c.news')
				expect(url.searchParams.get('goal')).toBeNull()
				return HttpResponse.json([{ x: '/a', y: 3 }])
			})
		)
		await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({
				metrics: ['visitors'],
				dimensions: ['page'],
				filters: [
					{ dimension: 'utmSource', operator: 'contains', value: 'news' },
					{ dimension: 'goal', operator: 'eq', value: 'signup' },
				],
			}),
			{}
		)
	})

	it('writes an explicit eq. prefix so a value starting with an operator stays literal', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', ({ request }) => {
				expect(new URL(request.url).searchParams.get('referrer')).toBe('eq.s.example.com')
				return HttpResponse.json({
					pageviews: 1,
					visitors: 1,
					visits: 1,
					bounces: 0,
					totaltime: 0,
				})
			})
		)
		await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'referrer', operator: 'eq', value: 's.example.com' }],
			}),
			{}
		)
	})

	it('answers two conflicting eq filters on one param as empty, without calling the API', async () => {
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [
					{ dimension: 'country', operator: 'eq', value: 'DE' },
					{ dimension: 'country', operator: 'eq', value: 'FR' },
				],
			}),
			{}
		)
		// msw is set to error on an unhandled request, so reaching the API would fail the test.
		expect(result.rows).toEqual([])
		expect(result.totals).toBeUndefined()
		expect(result.meta.provider).toBe('umami')
	})

	it('keeps the first filter on a param a second one cannot share, and reports the drop', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', ({ request }) => {
				expect(new URL(request.url).searchParams.get('country')).toBe('c.DE')
				return HttpResponse.json({
					pageviews: 1,
					visitors: 1,
					visits: 1,
					bounces: 0,
					totaltime: 0,
				})
			})
		)
		const dropped = { dimension: 'country', operator: 'matches', value: 'D.' } as const
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'country', operator: 'contains', value: 'DE' }, dropped],
			}),
			{}
		)
		expect(result.meta.unappliedFilters).toEqual([dropped])
	})

	it('scopes the path param to q.path over a page filter, and reports the one it displaced', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', ({ request }) => {
				expect(new URL(request.url).searchParams.get('path')).toBe('eq./pricing')
				return HttpResponse.json({
					pageviews: 1,
					visitors: 1,
					visits: 1,
					bounces: 0,
					totaltime: 0,
				})
			})
		)
		const displaced = { dimension: 'page', operator: 'contains', value: '/docs' } as const
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['pageviews'], path: '/pricing', filters: [displaced] }),
			{}
		)
		expect(result.meta.unappliedFilters).toEqual([displaced])
	})

	it('leaves meta.unappliedFilters off a read that carried every filter', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/stats', () =>
				HttpResponse.json({ pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 0 })
			)
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			}),
			{}
		)
		expect(result.meta.unappliedFilters).toBeUndefined()
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

	it('forwards the query timezone to the pageviews series endpoint', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/pageviews', ({ request }) => {
				expect(new URL(request.url).searchParams.get('timezone')).toBe('Europe/Berlin')
				return HttpResponse.json({ pageviews: [], sessions: [] })
			}),
			http.get('https://api.umami.is/v1/websites/w/stats', () =>
				HttpResponse.json({ pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 })
			)
		)
		await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['pageviews'], granularity: 'day', timezone: 'Europe/Berlin' }),
			{}
		)
	})

	it('returns a per-day pageviews/sessions series plus full totals when granularity is day', async () => {
		server.use(
			http.get('https://api.umami.is/v1/websites/w/pageviews', ({ request }) => {
				const url = new URL(request.url)
				expect(url.searchParams.get('unit')).toBe('day')
				expect(url.searchParams.get('timezone')).toBe('UTC')
				return HttpResponse.json({
					pageviews: [
						{ x: '2026-01-01 00:00:00', y: 10 },
						{ x: '2026-01-02 00:00:00', y: 25 },
					],
					sessions: [
						{ x: '2026-01-01 00:00:00', y: 4 },
						{ x: '2026-01-02 00:00:00', y: 9 },
					],
				})
			}),
			http.get('https://api.umami.is/v1/websites/w/stats', () =>
				HttpResponse.json({ pageviews: 35, visitors: 20, visits: 13, bounces: 5, totaltime: 700 })
			)
		)
		const result = await umami({ websiteId: 'w', apiKey: 'k' }).query(
			q({ metrics: ['pageviews', 'sessions', 'visitors'], granularity: 'day' }),
			{}
		)
		// pageviews + sessions have a per-day source; visitors does not, so rows omit it.
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 10, sessions: 4 } },
			{ timestamp: '2026-01-02T00:00:00.000Z', metrics: { pageviews: 25, sessions: 9 } },
		])
		// the headline total stays correct for every metric, including visitors.
		expect(result.totals?.pageviews).toBe(35)
		expect(result.totals?.visitors).toBe(20)
	})
})

describe('umami capture', () => {
	it('builds the two proxy routes against the cloud script/collector hosts by default', () => {
		const capture = umami({ websiteId: 'w', apiKey: 'k' }).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/script.js', upstream: 'https://cloud.umami.is/script.js' },
			{ source: '/api/send', upstream: 'https://gateway.umami.is/api/send' },
		])
	})

	it('builds the two proxy routes against the self-hosted app origin, stripping the /api suffix', () => {
		const capture = umami({
			websiteId: 'w',
			token: 't',
			host: 'https://analytics.example.com/api',
		}).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/script.js', upstream: 'https://analytics.example.com/script.js' },
			{ source: '/api/send', upstream: 'https://analytics.example.com/api/send' },
		])
	})

	it('derives the same origin from a host without the /api suffix', () => {
		const capture = umami({
			websiteId: 'w',
			token: 't',
			host: 'https://analytics.example.com',
		}).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/script.js', upstream: 'https://analytics.example.com/script.js' },
			{ source: '/api/send', upstream: 'https://analytics.example.com/api/send' },
		])
	})

	it('derives the same origin from a host with a trailing slash', () => {
		const capture = umami({
			websiteId: 'w',
			token: 't',
			host: 'https://analytics.example.com/api/',
		}).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/script.js', upstream: 'https://analytics.example.com/script.js' },
			{ source: '/api/send', upstream: 'https://analytics.example.com/api/send' },
		])
	})

	it('renders the tracker script tag with the website id and proxy path', () => {
		const capture = umami({ websiteId: 'w', apiKey: 'k' }).capture
		expect(capture?.snippet({ path: '/um' })).toEqual({
			scripts: [
				{
					src: '/um/script.js',
					defer: true,
					attrs: { 'data-website-id': 'w', 'data-host-url': '/um' },
				},
			],
		})
	})

	it('client carries only the kind, no api key or token', () => {
		const capture = umami({ websiteId: 'w', apiKey: 'secret', token: 'also-secret' }).capture
		expect(capture?.client).toEqual({ kind: 'umami' })
		expect(JSON.parse(JSON.stringify(capture?.client))).toEqual({ kind: 'umami' })
	})
})
