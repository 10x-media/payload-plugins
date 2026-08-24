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
	it('defaults maxLookbackDays to 730 and allows overriding to null', () => {
		expect(posthog({ projectId: '123', apiKey: 'phx_k' }).capabilities.maxLookbackDays).toBe(730)
		expect(
			posthog({ projectId: '123', apiKey: 'phx_k', maxLookbackDays: null }).capabilities
				.maxLookbackDays
		).toBeNull()
	})

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
		expect(body.query?.query).toContain('properties.$pathname AS dim')
		expect(body.query?.query).toContain('GROUP BY dim')
		expect(result.rows).toEqual([
			{ dimensions: { page: '/' }, metrics: { pageviews: 18043 } },
			{ dimensions: { page: '/pricing' }, metrics: { pageviews: 7412 } },
		])
		expect(result.totals).toBeUndefined()
	})

	it('supports the events metric with all-event conditional aggregation', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[900]] })
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['events'] }),
			{}
		)
		const sql = body.query?.query ?? ''
		// No blanket pageview filter, so total events include every captured event.
		expect(sql).not.toContain("event = '$pageview'")
		expect(sql).toContain('count() AS m0')
		expect(result.totals).toEqual({ events: 900 })
	})

	it('scopes pageview-family metrics with conditional aggregates when events is also requested', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({
					columns: ['m0', 'm1'],
					types: ['UInt64', 'UInt64'],
					results: [[120, 900]],
				})
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews', 'events'] }),
			{}
		)
		const sql = body.query?.query ?? ''
		expect(sql).not.toContain("WHERE event = '$pageview'")
		expect(sql).toContain("countIf(event = '$pageview') AS m0")
		expect(sql).toContain('count() AS m1')
		expect(result.totals).toEqual({ pageviews: 120, events: 900 })
	})

	it('breaks down by event name', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({
					columns: ['dim', 'm0'],
					types: ['String', 'UInt64'],
					results: [
						['signup', 42],
						['purchase', 11],
					],
				})
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['events'], dimensions: ['event'] }),
			{}
		)
		const sql = body.query?.query ?? ''
		expect(sql).toContain('event AS dim')
		expect(sql).toContain('GROUP BY dim')
		expect(result.rows).toEqual([
			{ dimensions: { event: 'signup' }, metrics: { events: 42 } },
			{ dimensions: { event: 'purchase' }, metrics: { events: 11 } },
		])
	})

	it('filters by hostname via properties.$host', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[1]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], hostname: 'a.example.com' }),
			{}
		)
		expect(body.query?.query).toContain("properties.$host = 'a.example.com'")
	})

	it('exposes the events metric and event dimension in capabilities', () => {
		const caps = posthog({ projectId: '123', apiKey: 'phx_k' }).capabilities
		expect(caps.metrics.has('events')).toBe(true)
		expect(caps.dimensions.has('event')).toBe(true)
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

	it('returns a per-day series plus range totals when granularity is day', async () => {
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const body = (await request.json()) as { query?: { query?: string } }
				const sql = body.query?.query ?? ''
				if (sql.includes('GROUP BY day')) {
					return HttpResponse.json({
						columns: ['day', 'm0', 'm1', 'm2'],
						types: [],
						results: [
							['2026-01-01 00:00:00', 10, 7, 5],
							['2026-01-02 00:00:00', 25, 18, 12],
						],
					})
				}
				return HttpResponse.json({
					columns: ['m0', 'm1', 'm2'],
					types: [],
					results: [[35, 20, 15]],
				})
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews', 'visitors', 'sessions'], granularity: 'day' }),
			{}
		)
		expect(result.rows).toEqual([
			{
				timestamp: '2026-01-01T00:00:00.000Z',
				metrics: { pageviews: 10, visitors: 7, sessions: 5 },
			},
			{
				timestamp: '2026-01-02T00:00:00.000Z',
				metrics: { pageviews: 25, visitors: 18, sessions: 12 },
			},
		])
		expect(result.totals).toEqual({ pageviews: 35, visitors: 20, sessions: 15 })
	})

	it('buckets the day series in the query timezone when set', async () => {
		let seriesSql = ''
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const sql = ((await request.json()) as { query?: { query?: string } }).query?.query ?? ''
				if (sql.includes('GROUP BY day')) {
					seriesSql = sql
					return HttpResponse.json({ columns: ['day', 'm0'], types: [], results: [] })
				}
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[0]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], granularity: 'day', timezone: 'Europe/Berlin' }),
			{}
		)
		expect(seriesSql).toContain("toStartOfDay(timestamp, 'Europe/Berlin')")
	})

	it('buckets the day series explicitly in UTC by default (never the project timezone)', async () => {
		let seriesSql = ''
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const sql = ((await request.json()) as { query?: { query?: string } }).query?.query ?? ''
				if (sql.includes('GROUP BY day')) {
					seriesSql = sql
					return HttpResponse.json({ columns: ['day', 'm0'], types: [], results: [] })
				}
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[0]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], granularity: 'day' }),
			{}
		)
		expect(seriesSql).toContain("toStartOfDay(timestamp, 'UTC') AS day")
	})

	it('declares filters as the DIMENSION_SQL key set and hour as minGranularity', () => {
		const caps = posthog({ projectId: '123', apiKey: 'phx_k' }).capabilities
		expect(caps.filters).toEqual(new Set(['page', 'event']))
		expect(caps.filterOperators).toEqual(new Set(['eq', 'contains', 'matches']))
		expect(caps.minGranularity).toBe('hour')
	})

	it('applies an eq filter as an equality expression', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[1]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'page', operator: 'eq', value: '/pricing' }],
			}),
			{}
		)
		expect(body.query?.query).toContain("properties.$pathname = '/pricing'")
	})

	it('applies a contains filter as an escaped ILIKE pattern', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[1]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'page', operator: 'contains', value: '50%_off' }],
			}),
			{}
		)
		expect(body.query?.query).toContain("properties.$pathname ILIKE '%50\\\\%\\\\_off%'")
	})

	it('applies a matches filter via the HogQL match() function', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[1]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'event', operator: 'matches', value: '^signup' }],
			}),
			{}
		)
		expect(body.query?.query).toContain("match(event, '^signup')")
	})

	it('drops a filter for a dimension it cannot serve instead of throwing', async () => {
		let body: { query?: { query?: string } } = {}
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				body = (await request.json()) as typeof body
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[1]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({
				metrics: ['pageviews'],
				filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			}),
			{}
		)
		expect(body.query?.query).not.toContain('DE')
	})

	it('returns a per-hour series plus range totals when granularity is hour', async () => {
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const body = (await request.json()) as { query?: { query?: string } }
				const sql = body.query?.query ?? ''
				if (sql.includes('GROUP BY hour')) {
					return HttpResponse.json({
						columns: ['hour', 'm0'],
						types: [],
						results: [
							['2026-01-01 00:00:00', 10],
							['2026-01-01 01:00:00', 25],
						],
					})
				}
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[35]] })
			})
		)
		const result = await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], granularity: 'hour' }),
			{}
		)
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 10 } },
			{ timestamp: '2026-01-01T01:00:00.000Z', metrics: { pageviews: 25 } },
		])
		expect(result.totals).toEqual({ pageviews: 35 })
	})

	it('buckets the hour series in the query timezone when set', async () => {
		let seriesSql = ''
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const sql = ((await request.json()) as { query?: { query?: string } }).query?.query ?? ''
				if (sql.includes('GROUP BY hour')) {
					seriesSql = sql
					return HttpResponse.json({ columns: ['hour', 'm0'], types: [], results: [] })
				}
				return HttpResponse.json({ columns: ['m0'], types: [], results: [[0]] })
			})
		)
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(
			q({ metrics: ['pageviews'], granularity: 'hour', timezone: 'Europe/Berlin' }),
			{}
		)
		expect(seriesSql).toContain("toStartOfHour(timestamp, 'Europe/Berlin')")
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

describe('posthog scopeProperty', () => {
	const captureSql = (): { get: () => string } => {
		let sql = ''
		server.use(
			http.post('https://us.posthog.com/api/projects/123/query/', async ({ request }) => {
				const body = (await request.json()) as { query?: { query?: string } }
				sql = body.query?.query ?? ''
				return HttpResponse.json({ columns: ['m0'], types: ['UInt64'], results: [[1]] })
			})
		)
		return { get: () => sql }
	}

	it('declares scopedQueries only when a scopeProperty is configured', () => {
		expect(posthog({ projectId: '123', apiKey: 'k' }).capabilities.scopedQueries).toBeUndefined()
		expect(
			posthog({ projectId: '123', apiKey: 'k', scopeProperty: 'tenant' }).capabilities.scopedQueries
		).toBe(true)
	})

	it('filters by the scope property with escaped literals', async () => {
		const sql = captureSql()
		await posthog({ projectId: '123', apiKey: 'k', scopeProperty: 'tenant' }).query(
			q({ metrics: ['pageviews'], scope: 'acme' }),
			{}
		)
		expect(sql.get()).toContain("properties['tenant'] = 'acme'")
	})

	it('escapes injection attempts in both the property name and the scope value', async () => {
		const sql = captureSql()
		await posthog({
			projectId: '123',
			apiKey: 'k',
			scopeProperty: "t' OR 1=1 --",
		}).query(q({ metrics: ['pageviews'], scope: "a'; DROP TABLE events --" }), {})
		expect(sql.get()).toContain("properties['t\\' OR 1=1 --'] = 'a\\'; DROP TABLE events --'")
		expect(sql.get()).not.toContain("= 'a'; DROP")
	})

	it('adds no scope filter when the query has no scope or no property is configured', async () => {
		const noScope = captureSql()
		await posthog({ projectId: '123', apiKey: 'k', scopeProperty: 'tenant' }).query(
			q({ metrics: ['pageviews'] }),
			{}
		)
		expect(noScope.get()).not.toContain("properties['tenant']")

		const noProperty = captureSql()
		await posthog({ projectId: '123', apiKey: 'k' }).query(
			q({ metrics: ['pageviews'], scope: 'acme' }),
			{}
		)
		expect(noProperty.get()).not.toContain('acme')
	})
})
