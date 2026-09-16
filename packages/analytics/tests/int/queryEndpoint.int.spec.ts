import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { type CollectionConfig, type Endpoint, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ProviderHttpError } from '../../src/adapters/http/fetchJson'
import {
	type AnalyticsAdapter,
	type AnalyticsCapabilities,
	type AnalyticsQuery,
	PLATFORM_SCOPE,
} from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import {
	DOCUMENT_PATH,
	GOALS_PATH,
	QUERY_PATH,
	REALTIME_PATH,
	SOURCES_PATH,
} from '../../src/plugin/paths'
import type { QueryResponse } from '../../src/query/response'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

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
	perPageQuery: true,
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors']),
	dimensions: new Set(['page']),
	filters: new Set(['page']),
	filterOperators: new Set(['eq']),
	batchPageReport: false,
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

describeForDb('analytics query endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string
	const mem = memoryAdapter()

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
							filters: new Set(),
							filterOperators: new Set(),
							metrics: new Set(['pageviews']),
							dimensions: new Set(['page']),
						},
						pageviews: 7,
					}),
					stubAdapter({
						id: 'lookback',
						label: 'Short lookback source',
						capabilities: { maxLookbackDays: 90 },
						pageviews: 3,
					}),
					stubAdapter({ id: 'unconfigured', label: 'Unconfigured source', configured: false }),
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

	const handler = () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === QUERY_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('query endpoint not registered')
		}
		return endpoint.handler
	}

	const user = { id: 1, email: 'reader@t.dev' }

	const call = (query: string, as: unknown = user): Promise<Response> =>
		Promise.resolve(
			handler()({
				payload: booted.payload,
				user: as,
				url: `http://localhost/api${QUERY_PATH}?${query}`,
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
			(e): e is Endpoint => typeof e === 'object' && e.path === QUERY_PATH
		)
		expect(endpoint?.method).toBe('get')
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
		const body = await okBody(`metrics=pageviews&compare=previous&${RANGE}`)
		expect(body.query.dateRange.start).toBe('2026-01-10T00:00:00.000Z')
		expect(body.comparison).toBeDefined()
		expect(body.comparison?.meta.fetchedAt).toBe('2026-01-09T23:59:59.999Z')
	})

	it(`adds the comparison for a provider-shaped source that never declared it on ${db}`, async () => {
		const body = await okBody(`source=lookback&metrics=pageviews&${RANGE}`)
		expect(body.capabilities.comparison).toBe(true)
	})

	it(`400s compare when the previous window predates the source lookback on ${db}`, async () => {
		const error = await errorBody(
			`source=lookback&metrics=pageviews&compare=previous&${RANGE}`,
			400
		)
		expect(error).toMatchObject({ code: 'invalid_param', param: 'compare' })
		expect(error.message).toContain("beyond the source's lookback")
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
			request: new Request(`http://localhost:3000/api${QUERY_PATH}?metrics=pageviews&${RANGE}`, {
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
			request: new Request(`http://localhost:3000/api${QUERY_PATH}?metrics=pageviews&${RANGE}`),
		})
		expect(res.status).toBe(401)
	})
})

describeForDb('analytics query endpoint - access.read', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers, { slug: 'pages', fields: [{ name: 'slug', type: 'text' }] }],
			db,
			plugin: analytics({
				adapters: [native()],
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

	const call = (path: string, query: string, email: string): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === path
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error(`endpoint ${path} not registered`)
		}
		return Promise.resolve(
			endpoint.handler({
				payload: booted.payload,
				user: { id: 1, email },
				url: `http://localhost/api${path}?${query}`,
				headers: new Headers(),
			} as unknown as PayloadRequest)
		)
	}

	const endpoints: Array<[string, string]> = [
		[QUERY_PATH, `metrics=pageviews&${RANGE}`],
		[DOCUMENT_PATH, 'collection=pages&id=000000000000000000000000'],
		[REALTIME_PATH, 'metric=visitors'],
		[SOURCES_PATH, ''],
		[GOALS_PATH, ''],
	]

	for (const [path, query] of endpoints) {
		it(`403s ${path} for a user access.read denies on ${db}`, async () => {
			const res = await call(path, query, 'denied@t.dev')
			expect(res.status).toBe(403)
		})
	}

	it(`serves the query endpoint to a user access.read grants on ${db}`, async () => {
		const res = await call(QUERY_PATH, `metrics=pageviews&${RANGE}`, 'allowed@t.dev')
		expect(res.status).toBe(200)
	})

	it(`keeps the sources wire shape for a user access.read grants on ${db}`, async () => {
		const res = await call(SOURCES_PATH, '', 'allowed@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			defaultId: string | null
			sources: Array<{ id: string; label: string; kind: string; capabilities: unknown }>
		}
		expect(body.defaultId).toBe('native')
		expect(Object.keys(body.sources[0] ?? {})).toEqual(['id', 'label', 'kind', 'capabilities'])
	})
})

describeForDb('analytics query endpoint - platform scope resolver', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [stubAdapter({ id: 'shared', pageviews: 4 })],
				scopeResolver: () => PLATFORM_SCOPE,
				access: {
					platformRead: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const call = (path: string, query: string, email: string): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === path
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error(`endpoint ${path} not registered`)
		}
		return Promise.resolve(
			endpoint.handler({
				payload: booted.payload,
				user: { id: 1, email },
				url: `http://localhost/api${path}?${query}`,
				headers: new Headers(),
			} as unknown as PayloadRequest)
		)
	}

	it(`lists no sources for a resolved platform scope the caller may not read on ${db}`, async () => {
		const res = await call(SOURCES_PATH, '', 'tenant@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as { defaultId: string | null; sources: unknown[] }
		expect(body).toEqual({ defaultId: null, sources: [] })
	})

	it(`404s a query for a resolved platform scope the caller may not read on ${db}`, async () => {
		const res = await call(QUERY_PATH, `metrics=pageviews&${RANGE}`, 'tenant@t.dev')
		expect(res.status).toBe(404)
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('unknown_source')
	})

	it(`reads install-wide for a platformRead user on ${db}`, async () => {
		const sources = await call(SOURCES_PATH, '', 'platform@t.dev')
		expect(((await sources.json()) as { defaultId: string | null }).defaultId).toBe('shared')
		const res = await call(QUERY_PATH, `metrics=pageviews&${RANGE}`, 'platform@t.dev')
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.query.scope).toBeUndefined()
	})
})

describeForDb('analytics query endpoint - scoped install', { dbs: ['mongo'] }, (db) => {
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
				scopeResolver: ({ req }) =>
					scopeByEmail[(req.user as { email?: string })?.email ?? ''] ?? null,
				access: {
					platformRead: ({ req }) =>
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

	const call = (query: string, email: string): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === QUERY_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('query endpoint not registered')
		}
		return Promise.resolve(
			endpoint.handler({
				payload: booted.payload,
				user: { id: 1, email },
				url: `http://localhost/api${QUERY_PATH}?${query}`,
				headers: new Headers(),
			} as unknown as PayloadRequest)
		)
	}

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

	it(`403s a tenant read through a shared source that cannot filter by scope on ${db}`, async () => {
		const res = await call(`source=shared&metrics=pageviews&${RANGE}`, 'a@t.dev')
		expect(res.status).toBe(403)
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('forbidden')
	})

	it(`404s a user whose request resolves no scope on ${db}`, async () => {
		const res = await call(`metrics=pageviews&${RANGE}`, 'nobody@t.dev')
		expect(res.status).toBe(404)
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('unknown_source')
	})

	it(`lets a platformRead user read another scope explicitly on ${db}`, async () => {
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

describeForDb('analytics query endpoint - stale passthrough', { dbs: ['mongo'] }, (db) => {
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
		await booted.stop()
	})

	const call = (params = 'metrics=pageviews'): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === QUERY_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('query endpoint not registered')
		}
		return Promise.resolve(
			endpoint.handler({
				payload: booted.payload,
				user: { id: 1 },
				url: `http://localhost/api${QUERY_PATH}?${params}&${RANGE}`,
				headers: new Headers(),
			} as unknown as PayloadRequest)
		)
	}

	it(`passes meta.stale through when the refresh fails after the entry expires on ${db}`, async () => {
		const first = (await (await call()).json()) as QueryResponse
		expect(first.result.totals?.pageviews).toBe(1)
		expect(first.result.meta.stale).toBeUndefined()

		// The aggregate TTL above is 1s; sleeping past it with a real timer expires the entry
		// without reaching into the cache store's clock, as engineResilience.int.spec.ts does.
		await new Promise((resolve) => setTimeout(resolve, 2_000))

		// A non-429 4xx never retries (retryPolicy.ts), so one failNext fails the whole read.
		mem.failNext(new ProviderHttpError(400, 'memory', 'memory: injected failure'))
		const second = (await (await call()).json()) as QueryResponse
		expect(second.result.meta.stale).toBe(true)
		expect(second.result.totals?.pageviews).toBe(1)
	})

	it(`503s with Retry-After when a cold read fails outright on ${db}`, async () => {
		mem.failNext(new ProviderHttpError(400, 'memory', 'memory: injected failure'))
		const res = await call('metrics=visitors')
		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('30')
		const body = (await res.json()) as ErrorBody
		expect(body.error.code).toBe('unavailable')
	})
})
