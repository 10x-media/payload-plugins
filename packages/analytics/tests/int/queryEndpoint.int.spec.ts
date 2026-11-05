import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { type CollectionConfig, type Endpoint, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../../src/adapters/http/fetchJson'
import {
	type AnalyticsAdapter,
	type AnalyticsCapabilities,
	type AnalyticsQuery,
	PLATFORM_SCOPE,
} from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { getRuntime } from '../../src/plugin/runtime'
import { askedAboutNoGoals, type QueryResponse } from '../../src/query/response'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { callEndpoint, handlerAt } from './endpointHelpers'
import { advancePayloadClock, resetPayloadClock } from './payloadClock'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const accessUsers: CollectionConfig = { slug: 'access-users', auth: true, fields: [] }

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result
}

type ErrorBody = { error: { code: string; message: string; param?: string } }

// No `comparison` key: a provider-shaped source that never declares it still compares.
const baseCapabilities: AnalyticsCapabilities = {
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors']),
	dimensions: new Set(['page']),
	filters: { page: ['eq'] },
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 3600 },
}

interface StubOptions {
	id: string
	label?: string
	capabilities?: Partial<AnalyticsCapabilities>
	pageviews?: number
	seen?: AnalyticsQuery[]
	configured?: boolean
}

const stubAdapter = (opts: StubOptions): AnalyticsAdapter => ({
	id: opts.id,
	label: opts.label ?? opts.id,
	capabilities: { ...baseCapabilities, ...opts.capabilities },
	isConfigured: () => opts.configured ?? true,
	query: async (q) => {
		opts.seen?.push(q)
		return {
			rows: [],
			totals: { pageviews: opts.pageviews ?? 0 },
			meta: { provider: opts.id, fetchedAt: q.dateRange.end.toISOString() },
		}
	},
})

const RANGE = 'from=2026-01-10&to=2026-01-16'

/**
 * Shaped like provider adapters: goal rows only for hinted slugs, a failed or absent hint says so
 * instead of counting every event, and a scope without goals is an empty table, not a failure.
 */
const goalsAdapter = (seen: AnalyticsQuery[]): AnalyticsAdapter => ({
	id: 'goals',
	label: 'Goal source',
	capabilities: {
		...baseCapabilities,
		metrics: new Set(['pageviews', 'conversions']),
		dimensions: new Set(['page', 'goal']),
	},
	isConfigured: () => true,
	query: async (q) => {
		seen.push(q)
		const fetchedAt = q.dateRange.end.toISOString()
		const slugs = q.goalSlugs
		if (slugs === undefined || slugs === 'unresolved') {
			return { rows: [], meta: { provider: 'goals', fetchedAt, goalsUnresolved: true } }
		}
		return {
			rows: slugs.map((slug) => ({ dimensions: { goal: slug }, metrics: { conversions: 1 } })),
			meta: { provider: 'goals', fetchedAt },
		}
	},
})

describeForDb('analytics query endpoint', {}, (db) => {
	let booted: BootedPayload
	let token: string
	const mem = memoryAdapter()
	const goalQueries: AnalyticsQuery[] = []

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [
					mem,
					stubAdapter({
						id: 'narrow',
						label: 'Narrow source',
						capabilities: {
							comparison: false,
							filters: {},
							metrics: new Set(['pageviews']),
							dimensions: new Set(['page']),
						},
						pageviews: 7,
					}),
					stubAdapter({
						id: 'wide',
						label: 'Wide lookback source',
						capabilities: { maxLookbackDays: 36_500 },
						pageviews: 5,
					}),
					stubAdapter({
						id: 'lookback',
						label: 'Short lookback source',
						capabilities: { maxLookbackDays: 1 },
						pageviews: 3,
					}),
					stubAdapter({ id: 'unconfigured', label: 'Unconfigured source', configured: false }),
					goalsAdapter(goalQueries),
				],
				defaultAdapter: 'memory',
			}),
		})
		mem.record({ path: '/a', timestamp: new Date('2026-01-12T10:00:00.000Z'), visitor: 'v1' })
		mem.record({ path: '/b', timestamp: new Date('2026-01-13T10:00:00.000Z'), visitor: 'v2' })
		const result = await login(booted.payload, 'reader@t.dev')
		token = result.token ?? ''
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = () => handlerAt(booted.payload, routes.query)

	const user = { id: 1, email: 'reader@t.dev', collection: 'access-users' }

	const call = (query: string, as: unknown = user): Promise<Response> =>
		Promise.resolve(
			handler()({
				payload: booted.payload,
				user: as,
				url: `http://localhost/api${routes.query}?${query}`,
				headers: new Headers(),
			} as unknown as PayloadRequest)
		)

	const okBody = async (query: string): Promise<QueryResponse> => {
		const res = await call(query)
		expect(res.status).toBe(200)
		return (await res.json()) as QueryResponse
	}

	const errorBody = async (query: string, status: number): Promise<ErrorBody['error']> => {
		const res = await call(query)
		expect(res.status).toBe(status)
		return ((await res.json()) as ErrorBody).error
	}

	it(`registers the endpoint under the api route on ${db}`, () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === routes.query
		)
		expect(endpoint?.method).toBe('get')
	})

	// No goals declared, so the hint carries only the latent built-in purchase goal: its slug must
	// reach the source (it matches at ingest), but reports read it as an install with no goals.
	it(`hints only the latent goal and names it as built in on ${db}`, async () => {
		goalQueries.length = 0
		const body = await okBody(`source=goals&metrics=conversions&dimensions=goal&${RANGE}`)
		expect(goalQueries[0]?.goalSlugs).toEqual(['purchase'])
		// The endpoint names latent slugs and reports drop their rows, rather than hiding rows a
		// consumer's own dashboard may want.
		expect(body.result.rows).toEqual([
			{ dimensions: { goal: 'purchase' }, metrics: { conversions: 1 } },
		])
		expect(body.result.meta.goalsUnresolved).toBeUndefined()
		// The echo is how a client tells this apart from a resolver that failed, which
		// echoes the string `unresolved` instead.
		expect(body.query.goalSlugs).toEqual(['purchase'])
		expect(body.builtinGoalSlugs).toEqual(['purchase'])
		expect(askedAboutNoGoals(body)).toBe(true)
	})

	it(`leaves a read that is about no goal unhinted on ${db}`, async () => {
		goalQueries.length = 0
		await okBody(`source=goals&metrics=pageviews&${RANGE}`)
		expect(goalQueries[0]?.goalSlugs).toBeUndefined()
	})

	it(`401s an anonymous request on ${db}`, async () => {
		const res = await call(`metrics=pageviews&${RANGE}`, null)
		expect(res.status).toBe(401)
	})

	it(`reads the default source and echoes the normalized query on ${db}`, async () => {
		const body = await okBody(`metrics=pageviews,visitors&${RANGE}`)
		expect(body.source).toEqual({ id: 'memory', label: mem.label, kind: 'config' })
		expect(body.result.totals?.pageviews).toBe(2)
		expect(body.capabilities.metrics).toContain('pageviews')
		expect(body.query.metrics).toEqual(['pageviews', 'visitors'])
		expect(body.query.limit).toBe(50)
		expect(body.query.timezone).toBe('UTC')
		expect(body.query.dateRange).toEqual({
			start: '2026-01-10T00:00:00.000Z',
			end: '2026-01-16T23:59:59.999Z',
		})
		expect(body.comparison).toBeUndefined()
	})

	it(`answers with Cache-Control private, no-store on ${db}`, async () => {
		const res = await call(`metrics=pageviews&${RANGE}`)
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it(`reads an explicitly named source on ${db}`, async () => {
		const body = await okBody(`source=narrow&metrics=pageviews&${RANGE}`)
		expect(body.source.id).toBe('narrow')
		expect(body.result.totals?.pageviews).toBe(7)
		expect(body.capabilities.comparison).toBe(false)
	})

	it(`answers 200 with an empty result for a source whose adapter is unconfigured on ${db}`, async () => {
		const body = await okBody(`source=unconfigured&metrics=pageviews&${RANGE}`)
		expect(body.result.rows).toEqual([])
		expect(body.result.totals).toBeUndefined()
		expect(body.result.meta.provider).toBe('unconfigured')
		expect(body.source.id).toBe('unconfigured')
	})

	it(`404s an unknown source id on ${db}`, async () => {
		const error = await errorBody(`source=nope&metrics=pageviews&${RANGE}`, 404)
		expect(error.code).toBe('unknown_source')
		expect(error.param).toBe('source')
	})

	it(`400s a metric the source does not serve on ${db}`, async () => {
		const error = await errorBody(`metrics=revenue&${RANGE}`, 400)
		expect(error).toMatchObject({ code: 'unsupported_metric', param: 'metrics' })
	})

	it(`400s a dimension the source does not break down by on ${db}`, async () => {
		const error = await errorBody(
			`source=narrow&metrics=pageviews&dimensions=country&${RANGE}`,
			400
		)
		expect(error).toMatchObject({ code: 'unsupported_dimension', param: 'dimensions' })
	})

	it(`400s a granularity finer than the source buckets on ${db}`, async () => {
		const error = await errorBody(`source=narrow&metrics=pageviews&granularity=hour&${RANGE}`, 400)
		expect(error).toMatchObject({ code: 'unsupported_granularity', param: 'granularity' })
	})

	it(`400s a filter the source cannot apply on ${db}`, async () => {
		const filters = encodeURIComponent(
			JSON.stringify([{ dimension: 'page', operator: 'eq', value: '/a' }])
		)
		const error = await errorBody(
			`source=narrow&metrics=pageviews&filters=${filters}&${RANGE}`,
			400
		)
		expect(error).toMatchObject({ code: 'unsupported_filter', param: 'filters' })
	})

	it(`400s a filter operator the source does not support on ${db}`, async () => {
		const filters = encodeURIComponent(
			JSON.stringify([{ dimension: 'page', operator: 'contains', value: '/a' }])
		)
		const error = await errorBody(`metrics=pageviews&filters=${filters}&${RANGE}`, 400)
		expect(error).toMatchObject({ code: 'unsupported_operator', param: 'filters' })
	})

	it(`400s compare against a source without comparison on ${db}`, async () => {
		const error = await errorBody(`source=narrow&metrics=pageviews&compare=previous&${RANGE}`, 400)
		expect(error).toMatchObject({ code: 'invalid_param', param: 'compare' })
	})

	it(`adds the previous window as comparison for compare=previous on ${db}`, async () => {
		const engine = getRuntime(booted.payload)?.engine
		if (!engine) {
			throw new Error('runtime missing after boot')
		}
		const reads = vi.spyOn(engine, 'read')
		const body = await okBody(`metrics=pageviews&compare=previous&${RANGE}`)
		expect(body.query.dateRange.start).toBe('2026-01-10T00:00:00.000Z')
		expect(body.comparison).toBeDefined()
		expect(reads.mock.calls.map(([, query]) => query.dateRange.end.toISOString())).toEqual([
			'2026-01-16T23:59:59.999Z',
			'2026-01-09T23:59:59.999Z',
		])
		reads.mockRestore()
	})

	it(`adds the comparison for a provider-shaped source that never declared it on ${db}`, async () => {
		const body = await okBody(`source=wide&metrics=pageviews&compare=previous&${RANGE}`)
		expect(body.capabilities.comparison).toBe(true)
		expect(body.comparison).toBeDefined()
		expect(body.comparison?.totals?.pageviews).toBe(5)
		expect(body.comparison?.meta.fetchedAt).toBe('2026-01-09T23:59:59.999Z')
	})

	it(`omits the comparison when the previous window predates the source lookback on ${db}`, async () => {
		const body = await okBody(`source=lookback&metrics=pageviews&compare=previous&${RANGE}`)
		expect(body.comparison).toBeUndefined()
		expect(body.result.totals?.pageviews).toBe(3)
	})

	it(`accepts a limit at the 500 cap and rejects one above it on ${db}`, async () => {
		const body = await okBody(`metrics=pageviews&limit=500&${RANGE}`)
		expect(body.query.limit).toBe(500)
		const error = await errorBody(`metrics=pageviews&limit=501&${RANGE}`, 400)
		expect(error).toMatchObject({ code: 'invalid_param', param: 'limit' })
	})

	it(`honors the timezone parameter in the normalized query on ${db}`, async () => {
		const body = await okBody(`metrics=pageviews&timezone=Europe%2FBerlin&${RANGE}`)
		expect(body.query.timezone).toBe('Europe/Berlin')
		expect(body.query.dateRange.start).toBe('2026-01-09T23:00:00.000Z')
	})

	it(`400s compare=previous over a range with no comparable previous window on ${db}`, async () => {
		const error = await errorBody(
			'metrics=pageviews&compare=previous&from=2026-01-01T00:00:00.000Z&to=2027-01-02T00:00:00.000Z',
			400
		)
		expect(error).toMatchObject({ code: 'invalid_param', param: 'compare' })
	})

	it(`serves a signed-in request through the REST router on ${db}`, async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${routes.query}?metrics=pageviews&${RANGE}`, {
				headers: { cookie: `payload-token=${token}` },
			}),
		})
		expect(res.status).toBe(200)
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		const body = (await res.json()) as QueryResponse
		expect(body.source.id).toBe('memory')
	})

	it(`401s an anonymous request through the REST router on ${db}`, async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${routes.query}?metrics=pageviews&${RANGE}`),
		})
		expect(res.status).toBe(401)
	})
})

describeForDb('analytics query endpoint - access.read', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers, { slug: 'pages', fields: [{ name: 'slug', type: 'text' }] }],
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				collections: { pages: { path: (doc) => (doc.slug ? `/${doc.slug as string}` : null) } },
				goals: [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }],
				access: {
					read: ({ req }) => (req.user as { email?: string } | null)?.email === 'allowed@t.dev',
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const call = (path: string, query: string, email: string): Promise<Response> =>
		callEndpoint(booted.payload, {
			path,
			query,
			user: { id: 1, email, collection: 'access-users' },
		})

	const endpoints: Array<[string, string]> = [
		[routes.query, `metrics=pageviews&${RANGE}`],
		[routes.document, 'collection=pages&id=000000000000000000000000'],
		[routes.live, 'metric=visitors'],
		[routes.sources, ''],
		[routes.goals, ''],
	]

	for (const [path, query] of endpoints) {
		it(`403s ${path} for a user access.read denies on ${db}`, async () => {
			const res = await call(path, query, 'denied@t.dev')
			expect(res.status).toBe(403)
		})
	}

	it(`serves the query endpoint to a user access.read grants on ${db}`, async () => {
		const res = await call(routes.query, `metrics=pageviews&${RANGE}`, 'allowed@t.dev')
		expect(res.status).toBe(200)
	})

	// The admin names native's sessions Visits, so a caller asking for `visits` gets that count.
	it(`answers visits from native's sessions, under the name asked for, on ${db}`, async () => {
		const res = await call(routes.query, `metrics=visits,pageviews&${RANGE}`, 'allowed@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.query.metrics).toEqual(['visits', 'pageviews'])
		expect(Object.keys(body.result.totals ?? {}).sort()).toEqual(['pageviews', 'visits'])
		const ranked = await call(
			routes.query,
			`metrics=visits&order=visits:desc&dimensions=page&${RANGE}`,
			'allowed@t.dev'
		)
		expect(ranked.status).toBe(200)
		const both = await call(routes.query, `metrics=sessions,visits&${RANGE}`, 'allowed@t.dev')
		expect(both.status).toBe(200)
		const totals = ((await both.json()) as QueryResponse).result.totals ?? {}
		expect(totals.visits).toBe(totals.sessions)
		expect(typeof totals.visits).toBe('number')
	})

	it(`keeps the sources wire shape for a user access.read grants on ${db}`, async () => {
		const res = await call(routes.sources, '', 'allowed@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			defaultId: string | null
			sources: Array<{ id: string; label: string; kind: string; capabilities: unknown }>
		}
		expect(body.defaultId).toBe('native')
		expect(Object.keys(body.sources[0] ?? {})).toEqual(['id', 'label', 'kind', 'capabilities'])
	})
})

describeForDb('analytics query endpoint - a scope resolver answering the wildcard', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [stubAdapter({ id: 'shared', pageviews: 4 })],
				scope: { member: () => true, resolve: () => PLATFORM_SCOPE },
				access: {
					crossScope: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const call = (path: string, query: string, email: string): Promise<Response> =>
		callEndpoint(booted.payload, {
			path,
			query,
			user: { id: 1, email, collection: 'access-users' },
		})

	// The wildcard is a reader's request for every scope. A resolver answering it would hand every
	// request the aggregate without the gate having been asked, so it is refused outright.
	it(`lists no sources for any reader, the resolver being refused on ${db}`, async () => {
		for (const email of ['tenant@t.dev', 'platform@t.dev']) {
			const res = await call(routes.sources, '', email)
			expect(res.status).toBe(200)
			const body = (await res.json()) as { defaultId: string | null; sources: unknown[] }
			expect(body).toEqual({ defaultId: null, sources: [] })
		}
	})

	it(`404s a query that leaves the scope to the resolver on ${db}`, async () => {
		for (const email of ['tenant@t.dev', 'platform@t.dev']) {
			const res = await call(routes.query, `metrics=pageviews&${RANGE}`, email)
			expect(res.status).toBe(404)
			const body = (await res.json()) as ErrorBody
			expect(body.error.code).toBe('unknown_source')
		}
	})

	it(`still reads install-wide for a reader the aggregate gate lets name every scope on ${db}`, async () => {
		const res = await call(routes.query, `metrics=pageviews&scope=*&${RANGE}`, 'platform@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.query.scope).toBeUndefined()
		const refused = await call(routes.query, `metrics=pageviews&scope=*&${RANGE}`, 'tenant@t.dev')
		expect(refused.status).toBe(400)
	})
})

describeForDb('analytics query endpoint - scoped install', {}, (db) => {
	let booted: BootedPayload
	const seen: AnalyticsQuery[] = []

	const scopeByEmail: Record<string, string> = {
		'a@t.dev': 'tenant-a',
		'b@t.dev': 'tenant-b',
	}

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				capture: { gate: 'off' },
				adapters: [
					stubAdapter({
						id: 'tenanted',
						capabilities: { scopedQueries: true },
						pageviews: 1,
						seen,
					}),
					stubAdapter({ id: 'shared', pageviews: 2, seen }),
				],
				defaultAdapter: 'tenanted',
				scope: {
					member: () => true,
					resolve: ({ req }) => scopeByEmail[(req.user as { email?: string })?.email ?? ''] ?? null,
				},
				access: {
					crossScope: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
				providers: {
					resolve: ({ scope }) =>
						scope === null ? [] : [stubAdapter({ id: `src-${scope}`, pageviews: 3, seen })],
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const call = (query: string, email: string): Promise<Response> =>
		callEndpoint(booted.payload, {
			path: routes.query,
			query,
			user: { id: 1, email, collection: 'access-users' },
		})

	it(`stamps the request's own scope on the read on ${db}`, async () => {
		const res = await call(`metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.source.id).toBe('tenanted')
		expect(body.query.scope).toBe('tenant-a')
	})

	it(`serves the scope's own runtime source on ${db}`, async () => {
		const res = await call(`source=src-tenant-a&metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.source).toEqual({ id: 'src-tenant-a', label: 'src-tenant-a', kind: 'runtime' })
		expect(body.query.scope).toBe('tenant-a')
	})

	it(`404s another tenant's runtime source on ${db}`, async () => {
		const res = await call(`source=src-tenant-b&metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(404)
		const body = (await res.json()) as ErrorBody
		expect(body.error).toMatchObject({ code: 'unknown_source', param: 'source' })
	})

	it(`400s a forged scope parameter on ${db}`, async () => {
		const res = await call(`scope=tenant-b&metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(400)
		const body = (await res.json()) as ErrorBody
		expect(body.error).toMatchObject({ code: 'untrusted_scope', param: 'scope' })
	})

	// A shared source that cannot filter by scope is not among this tenant's sources at all,
	// so naming it reads like naming a source that does not exist rather than like a refusal.
	it(`404s a tenant read through a shared source that cannot filter by scope on ${db}`, async () => {
		const res = await call(`source=shared&metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(404)
		const body = (await res.json()) as ErrorBody
		expect(body.error).toMatchObject({ code: 'unknown_source', param: 'source' })
	})

	it(`404s a user whose request resolves no scope on ${db}`, async () => {
		const res = await call(`metrics=pageviews&${RANGE}`, 'nobody@t.dev')
		expect(res.status).toBe(404)
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('unknown_source')
	})

	it(`lets a crossScope reader name another scope explicitly on ${db}`, async () => {
		const res = await call(
			`scope=tenant-b&source=src-tenant-b&metrics=pageviews&${RANGE}`,
			'platform@t.dev'
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.source.id).toBe('src-tenant-b')
		expect(body.query.scope).toBe('tenant-b')
	})

	it(`reads cross-scope for the platform scope marker on ${db}`, async () => {
		const res = await call(`scope=*&source=shared&metrics=visitors&${RANGE}`, 'platform@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.query.scope).toBeUndefined()
	})
})

describeForDb('analytics query endpoint - stale passthrough', {}, (db) => {
	let booted: BootedPayload
	const mem = memoryAdapter()

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({ adapters: [mem], cache: { ttl: { aggregate: 1 } } }),
		})
		mem.record({ path: '/a', timestamp: new Date('2026-01-12T10:00:00.000Z'), visitor: 'v1' })
	}, 240_000)

	afterAll(async () => {
		resetPayloadClock()
		await booted.stop()
	})

	const call = (params = 'metrics=pageviews'): Promise<Response> =>
		callEndpoint(booted.payload, {
			path: routes.query,
			query: `${params}&${RANGE}`,
			user: { id: 1, collection: 'access-users' },
		})

	it(`passes meta.stale through when the refresh fails after the entry expires on ${db}`, async () => {
		const first = (await (await call()).json()) as QueryResponse
		expect(first.result.totals?.pageviews).toBe(1)
		expect(first.result.meta.stale).toBeUndefined()

		// Past the aggregate TTL above (1s) on the clock the cache expires its entries by.
		await advancePayloadClock(booted.payload, 2_000)

		// The expired entry is answered at once and refreshed behind the answer, so the refresh
		// failing changes nothing for this read.
		mem.failNext(new ProviderHttpError(503, 'memory', 'memory: injected outage'))
		const second = (await (await call()).json()) as QueryResponse
		expect(second.result.meta.stale).toBe(true)
		expect(second.result.totals?.pageviews).toBe(1)
		// The refresh retries behind the answer; let it finish before the next read injects failures.
		await getRuntime(booted.payload)?.engine.idle?.()
	})

	it(`503s with Retry-After when a cold read fails outright on ${db}`, async () => {
		// An outage is retried twice, so the whole read fails only when all three attempts do.
		mem.failNext(new ProviderHttpError(503, 'memory', 'memory: injected outage'), 3)
		const res = await call('metrics=visitors')
		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('30')
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('unavailable')
	})

	it(`400s a query the source refuses as asked, blaming the query on ${db}`, async () => {
		mem.failNext(new ProviderHttpError(400, 'memory', 'memory: bad query detail'))
		const res = await call('metrics=sessions')
		expect(res.status).toBe(400)
		expect(res.headers.get('Retry-After')).toBeNull()
		const body = (await res.json()) as ErrorBody
		expect(body.error).toEqual({
			code: 'invalid_param',
			message: 'analytics: the source refused this query as asked',
			param: 'query',
		})
	})

	// Last in the block: a refused key opens the source's breaker for every later read.
	it(`502s a refused key, and keeps saying so at once while the source rests on ${db}`, async () => {
		mem.failNext(new ProviderHttpError(401, 'memory', 'memory: key revoked'))
		const refused = await call('metrics=bounceRate')
		expect(refused.status).toBe(502)
		expect(refused.headers.get('Retry-After')).toBeNull()
		expect(((await refused.json()) as ErrorBody).error).toMatchObject({
			code: 'source_misconfigured',
			param: 'source',
		})
		const resting = await call('metrics=avgDuration')
		expect(resting.status).toBe(502)
		expect(resting.headers.get('Retry-After')).toBeNull()
		expect(((await resting.json()) as ErrorBody).error.code).toBe('source_misconfigured')
	})
})
