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
	it('defaults maxLookbackDays to 730 and allows overriding to null', () => {
		expect(plausible({ siteId: 's', apiKey: 'k' }).capabilities.maxLookbackDays).toBe(730)
		expect(
			plausible({ siteId: 's', apiKey: 'k', maxLookbackDays: null }).capabilities.maxLookbackDays
		).toBeNull()
	})

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

	it('adds an event:hostname filter when a hostname is provided', async () => {
		let captured: { filters?: unknown } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({
					results: [{ metrics: [1, 1, 1], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		await adapter.query(q({ path: '/pricing', hostname: 'a.example.com' }), {})
		expect(captured.filters).toEqual([
			['is', 'event:page', ['/pricing']],
			['is', 'event:hostname', ['a.example.com']],
		])
	})

	it('declares filters as the mapped dimensions except goal, with every contract operator', () => {
		const caps = plausible({ siteId: 's', apiKey: 'k' }).capabilities
		expect(caps.filters).toEqual(
			new Set([...caps.dimensions].filter((dimension) => dimension !== 'goal'))
		)
		expect(caps.filterOperators).toEqual(new Set(['eq', 'contains', 'matches']))
	})

	it.each([
		['eq' as const, 'is'],
		['contains' as const, 'contains'],
		['matches' as const, 'matches'],
	])('sends a %s filter as the v2 "%s" clause', async (operator, clause) => {
		let captured: { filters?: unknown } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({
					results: [{ metrics: [1, 1, 1], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		await adapter.query(q({ filters: [{ dimension: 'country', operator, value: 'DE' }] }), {})
		expect(captured.filters).toEqual([[clause, 'visit:country', ['DE']]])
	})

	it('keeps the per-page and hostname clauses on "is" while a filter uses its own operator', async () => {
		let captured: { filters?: unknown } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({
					results: [{ metrics: [1, 1, 1], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		await adapter.query(
			q({
				path: '/pricing',
				hostname: 'a.example.com',
				filters: [{ dimension: 'page', operator: 'matches', value: '/docs/.*' }],
			}),
			{}
		)
		expect(captured.filters).toEqual([
			['is', 'event:page', ['/pricing']],
			['is', 'event:hostname', ['a.example.com']],
			['matches', 'event:page', ['/docs/.*']],
		])
	})

	it('drops a filter for an unmapped dimension', async () => {
		let captured: { filters?: unknown } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({
					results: [{ metrics: [1, 1, 1], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const adapter = plausible({ siteId: 'example.com', apiKey: 'k' })
		await adapter.query(
			q({ filters: [{ dimension: 'event', operator: 'eq', value: 'signup' }] }),
			{}
		)
		expect(captured.filters).toBeUndefined()
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

	it('returns a per-day series plus range totals when granularity is day', async () => {
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				const body = (await request.json()) as { dimensions?: string[] }
				if (body.dimensions?.[0] === 'time:day') {
					return HttpResponse.json({
						results: [
							{ metrics: [10, 7, 30], dimensions: ['2026-01-01'] },
							{ metrics: [25, 18, 40], dimensions: ['2026-01-02'] },
						],
						meta: {},
						query: {},
					})
				}
				return HttpResponse.json({
					results: [{ metrics: [35, 20, 35], dimensions: [] }],
					meta: {},
					query: {},
				})
			})
		)
		const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
			q({ metrics: ['pageviews', 'visitors', 'avgDuration'], granularity: 'day' }),
			{}
		)
		expect(result.rows).toEqual([
			{
				timestamp: '2026-01-01T00:00:00.000Z',
				metrics: { pageviews: 10, visitors: 7, avgDuration: 30000 },
			},
			{
				timestamp: '2026-01-02T00:00:00.000Z',
				metrics: { pageviews: 25, visitors: 18, avgDuration: 40000 },
			},
		])
		expect(result.totals).toEqual({ pageviews: 35, visitors: 20, avgDuration: 35000 })
	})
	describe('goals and conversions', () => {
		interface Body {
			metrics: string[]
			dimensions?: string[]
			filters?: unknown[]
		}

		/** Every request body the adapter sent, in call order. */
		const capture = (respond: (body: Body) => unknown): Body[] => {
			const bodies: Body[] = []
			server.use(
				http.post('https://plausible.io/api/v2/query', async ({ request }) => {
					const body = (await request.json()) as Body
					bodies.push(body)
					return HttpResponse.json({ results: respond(body), meta: {}, query: {} })
				})
			)
			return bodies
		}

		it('declares the goal dimension and conversions, and does not offer goal as a filter', () => {
			const caps = plausible({ siteId: 's', apiKey: 'k' }).capabilities
			expect(caps.dimensions.has('goal')).toBe(true)
			expect(caps.metrics.has('conversions')).toBe(true)
			expect(caps.filters.has('goal')).toBe(false)
		})

		it('offers revenue only once a revenue currency says the site has a revenue goal', () => {
			expect(plausible({ siteId: 's', apiKey: 'k' }).capabilities.metrics.has('revenue')).toBe(
				false
			)
			expect(
				plausible({ siteId: 's', apiKey: 'k', revenueCurrency: 'EUR' }).capabilities.metrics.has(
					'revenue'
				)
			).toBe(true)
		})

		// total_revenue needs a revenue goal: a site without one errors the whole request, so a
		// read asking for revenue against such a site must not send the metric at all.
		it('never sends total_revenue without a revenue currency', async () => {
			const bodies = capture(() => [{ metrics: [9], dimensions: ['Signup'] }])
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({
					metrics: ['conversions', 'revenue'],
					dimensions: ['goal'],
					goalSlugs: ['Signup'],
				}),
				{}
			)
			expect(bodies[0]?.metrics).toEqual(['events'])
			expect(result.rows).toEqual([{ dimensions: { goal: 'Signup' }, metrics: { conversions: 9 } }])
		})

		it('breaks down by event:goal, restricted to the hint, reading events as conversions', async () => {
			const bodies = capture(() => [
				{ metrics: [9, { value: 120.5, currency: 'EUR' }, 7], dimensions: ['Signup'] },
				{ metrics: [2, null, 2], dimensions: ['Purchase'] },
			])
			const result = await plausible({
				siteId: 'example.com',
				apiKey: 'k',
				revenueCurrency: 'EUR',
			}).query(
				q({
					metrics: ['conversions', 'revenue', 'visitors'],
					dimensions: ['goal'],
					goalSlugs: ['Signup', 'Purchase'],
				}),
				{}
			)
			expect(bodies).toHaveLength(1)
			expect(bodies[0]?.metrics).toEqual(['events', 'total_revenue', 'visitors'])
			expect(bodies[0]?.dimensions).toEqual(['event:goal'])
			expect(bodies[0]?.filters).toEqual([['is', 'event:goal', ['Signup', 'Purchase']]])
			expect(result.rows).toEqual([
				{
					dimensions: { goal: 'Signup' },
					metrics: { conversions: 9, revenue: 120.5, visitors: 7 },
				},
				{ dimensions: { goal: 'Purchase' }, metrics: { conversions: 2, visitors: 2 } },
			])
			expect(result.meta.goalsUnresolved).toBeUndefined()
		})

		it('serves no goal rows and says so when the read carries no hint', async () => {
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['conversions'], dimensions: ['goal'] }),
				{}
			)
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBe(true)
		})

		it('says so when the goal resolver failed', async () => {
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['conversions'], dimensions: ['goal'], goalSlugs: 'unresolved' }),
				{}
			)
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBe(true)
		})

		// A site with no goals configured has an empty goal table, not a broken one.
		it('serves an empty goal breakdown unflagged when the scope configures no goals', async () => {
			const bodies = capture(() => ({ results: [], meta: {}, query: {} }))
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['conversions'], dimensions: ['goal'], goalSlugs: [] }),
				{}
			)
			expect(bodies).toEqual([])
			expect(result.rows).toEqual([])
			expect(result.meta.goalsUnresolved).toBeUndefined()
		})

		it('reads conversions beside site metrics from a second, goal-filtered request', async () => {
			const bodies = capture((body) =>
				body.metrics.includes('events')
					? [{ metrics: [11], dimensions: [] }]
					: [{ metrics: [500, 300], dimensions: [] }]
			)
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({
					metrics: ['pageviews', 'visitors', 'conversions'],
					goalSlugs: ['signup'],
				}),
				{}
			)
			expect(bodies).toHaveLength(2)
			expect(bodies[0]?.metrics).toEqual(['pageviews', 'visitors'])
			expect(bodies[0]?.filters).toBeUndefined()
			expect(bodies[1]?.metrics).toEqual(['events'])
			expect(bodies[1]?.filters).toEqual([['is', 'event:goal', ['signup']]])
			expect(result.totals).toEqual({ pageviews: 500, visitors: 300, conversions: 11 })
			expect(result.rows).toEqual([{ metrics: { pageviews: 500, visitors: 300, conversions: 11 } }])
		})

		it('keeps the site metrics and drops conversions when the read carries no hint', async () => {
			const bodies = capture(() => [{ metrics: [500], dimensions: [] }])
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['pageviews', 'conversions'] }),
				{}
			)
			expect(bodies).toHaveLength(1)
			expect(bodies[0]?.metrics).toEqual(['pageviews'])
			expect(result.totals).toEqual({ pageviews: 500 })
			expect(result.meta.goalsUnresolved).toBe(true)
		})

		// total_revenue needs a revenue goal in scope: requested on a site-wide read, the API
		// rejects the whole query.
		it('never asks for total_revenue outside a goal-filtered request', async () => {
			const bodies = capture((body) =>
				body.metrics.includes('total_revenue')
					? [{ metrics: [{ value: 42, currency: 'EUR' }], dimensions: [] }]
					: [{ metrics: [500], dimensions: [] }]
			)
			const result = await plausible({
				siteId: 'example.com',
				apiKey: 'k',
				revenueCurrency: 'EUR',
			}).query(q({ metrics: ['pageviews', 'revenue'], goalSlugs: ['purchase'] }), {})
			expect(bodies[0]?.metrics).toEqual(['pageviews'])
			expect(bodies[1]?.metrics).toEqual(['total_revenue'])
			expect(bodies[1]?.filters).toEqual([['is', 'event:goal', ['purchase']]])
			expect(result.totals).toEqual({ pageviews: 500, revenue: 42 })
		})

		it('carries the page filter into the goal request too', async () => {
			const bodies = capture((body) =>
				body.metrics.includes('events')
					? [{ metrics: [3], dimensions: [] }]
					: [{ metrics: [9], dimensions: [] }]
			)
			await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['pageviews', 'conversions'], path: '/pricing', goalSlugs: ['signup'] }),
				{}
			)
			expect(bodies[1]?.filters).toEqual([
				['is', 'event:page', ['/pricing']],
				['is', 'event:goal', ['signup']],
			])
		})

		it('keeps the site rows and flags the goals when the goal request fails', async () => {
			const bodies: Body[] = []
			server.use(
				http.post('https://plausible.io/api/v2/query', async ({ request }) => {
					const body = (await request.json()) as Body
					bodies.push(body)
					if (body.metrics.includes('events')) {
						return new HttpResponse('no such goal', { status: 400 })
					}
					return HttpResponse.json({
						results: [{ metrics: [500, 300], dimensions: [] }],
						meta: {},
						query: {},
					})
				})
			)
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({ metrics: ['pageviews', 'visitors', 'conversions'], goalSlugs: ['signup'] }),
				{}
			)
			expect(bodies).toHaveLength(2)
			expect(result.totals).toEqual({ pageviews: 500, visitors: 300 })
			expect(result.meta.goalsUnresolved).toBe(true)
		})

		it('fails the read when the goal request is the only request it makes', async () => {
			server.use(
				http.post('https://plausible.io/api/v2/query', () =>
					HttpResponse.json({ error: 'nope' }, { status: 400 })
				)
			)
			await expect(
				plausible({ siteId: 'example.com', apiKey: 'k' }).query(
					q({ metrics: ['conversions'], goalSlugs: ['signup'] }),
					{}
				)
			).rejects.toThrow('HTTP 400')
		})

		it('unions a breakdown: a goal-only row is appended, a site-only row keeps no conversions', async () => {
			capture((body) =>
				body.metrics.includes('events')
					? [
							{ metrics: [4], dimensions: ['/pricing'] },
							{ metrics: [1], dimensions: ['/thanks'] },
						]
					: [
							{ metrics: [90], dimensions: ['/pricing'] },
							{ metrics: [30], dimensions: ['/blog'] },
						]
			)
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({
					metrics: ['pageviews', 'conversions'],
					dimensions: ['page'],
					goalSlugs: ['signup'],
				}),
				{}
			)
			expect(result.rows).toEqual([
				{ dimensions: { page: '/pricing' }, metrics: { pageviews: 90, conversions: 4 } },
				{ dimensions: { page: '/blog' }, metrics: { pageviews: 30 } },
				{ dimensions: { page: '/thanks' }, metrics: { conversions: 1 } },
			])
		})

		it('merges goal-filtered conversions into a daily series by day', async () => {
			const bodies = capture((body) => {
				const goal = body.metrics.includes('events')
				if (!body.dimensions) {
					return [{ metrics: goal ? [4] : [90], dimensions: [] }]
				}
				return goal
					? [{ metrics: [3], dimensions: ['2026-01-02'] }]
					: [
							{ metrics: [50], dimensions: ['2026-01-01'] },
							{ metrics: [40], dimensions: ['2026-01-02'] },
						]
			})
			const result = await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
				q({
					metrics: ['pageviews', 'conversions'],
					granularity: 'day',
					goalSlugs: ['signup'],
				}),
				{}
			)
			expect(bodies).toHaveLength(4)
			expect(result.rows).toEqual([
				{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 50 } },
				{ timestamp: '2026-01-02T00:00:00.000Z', metrics: { pageviews: 40, conversions: 3 } },
			])
			expect(result.totals).toEqual({ pageviews: 90, conversions: 4 })
		})
	})
})

describe('plausible capture', () => {
	it('builds the two proxy routes against the cloud host by default', () => {
		const capture = plausible({ siteId: 'example.com', apiKey: 'k', domain: 'example.com' }).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/js/:script*', upstream: 'https://plausible.io/js/:script*' },
			{ source: '/api/event', upstream: 'https://plausible.io/api/event' },
		])
	})

	it('builds the two proxy routes against a self-hosted host', () => {
		const capture = plausible({
			siteId: 'example.com',
			apiKey: 'k',
			host: 'https://p.acme.io',
			domain: 'example.com',
		}).capture
		expect(capture?.proxy.routes).toEqual([
			{ source: '/js/:script*', upstream: 'https://p.acme.io/js/:script*' },
			{ source: '/api/event', upstream: 'https://p.acme.io/api/event' },
		])
	})

	it('renders the legacy script tag when domain is set', () => {
		const capture = plausible({ siteId: 'example.com', apiKey: 'k', domain: 'example.com' }).capture
		expect(capture?.snippet({ path: '/pl' })).toEqual({
			scripts: [
				{
					src: '/pl/js/script.js',
					defer: true,
					attrs: { 'data-domain': 'example.com', 'data-api': '/pl/api/event' },
				},
			],
		})
	})

	it('renders the per-site script plus the official stub and init', () => {
		const capture = plausible({ siteId: 'example.com', apiKey: 'k', scriptId: 'abc123' }).capture
		const scripts = capture?.snippet({ path: '/pl' }).scripts ?? []
		expect(scripts).toHaveLength(2)
		expect(scripts[0]).toEqual({ src: '/pl/js/pa-abc123.js', async: true })
		const inline = scripts[1]?.inline ?? ''
		// The stub queues calls made before the tracker lands and parks the options for it,
		// which is what makes the inline safe as a sibling of an async loader.
		expect(inline).toContain(
			'window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}'
		)
		expect(inline).toContain('window.plausible.o=e||{}')
		expect(inline.endsWith('plausible.init({endpoint:"/pl/api/event"})')).toBe(true)
	})

	it('prefers the legacy tag when both domain and scriptId are set', () => {
		const capture = plausible({
			siteId: 'example.com',
			apiKey: 'k',
			domain: 'example.com',
			scriptId: 'abc123',
		}).capture
		expect(capture?.snippet({ path: '/pl' }).scripts).toHaveLength(1)
		expect(capture?.snippet({ path: '/pl' }).scripts[0]?.src).toBe('/pl/js/script.js')
	})

	// Capture is public config: without a public script identity there is nothing to capture
	// with, so a read-only install gets no proxy and no snippet rather than an empty one.
	it('declares no capture when neither domain nor scriptId is set', () => {
		expect(plausible({ siteId: 'example.com', apiKey: 'k' }).capture).toBeUndefined()
	})

	it('formats both range bounds as calendar days in the reporting timezone', async () => {
		let captured: { date_range?: string[] } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({ results: [], meta: {}, query: {} })
			})
		)
		await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
			q({
				timezone: 'America/New_York',
				dateRange: {
					start: new Date('2026-09-01T04:00:00.000Z'),
					end: new Date('2026-09-08T03:59:59.999Z'),
				},
			}),
			{}
		)
		expect(captured.date_range).toEqual(['2026-09-01', '2026-09-07'])
	})

	it('does not roll the start bound back a day for zones east of UTC', async () => {
		let captured: { date_range?: string[] } = {}
		server.use(
			http.post('https://plausible.io/api/v2/query', async ({ request }) => {
				captured = (await request.json()) as typeof captured
				return HttpResponse.json({ results: [], meta: {}, query: {} })
			})
		)
		await plausible({ siteId: 'example.com', apiKey: 'k' }).query(
			q({
				timezone: 'Europe/Berlin',
				dateRange: {
					start: new Date('2026-08-31T22:00:00.000Z'),
					end: new Date('2026-09-07T21:59:59.999Z'),
				},
			}),
			{}
		)
		expect(captured.date_range).toEqual(['2026-09-01', '2026-09-07'])
	})

	it('client carries only the kind, no site credentials', () => {
		const capture = plausible({
			siteId: 'example.com',
			apiKey: 'secret-key',
			domain: 'example.com',
		}).capture
		expect(capture?.client).toEqual({ kind: 'plausible' })
		expect(JSON.parse(JSON.stringify(capture?.client))).toEqual({ kind: 'plausible' })
	})
})
