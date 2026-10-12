import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { makeRealtimeHandler } from './realtimeEndpoint'
import { type AnalyticsRuntime, setRuntime } from './runtime'

type ErrorBody = { error: { code: string; param?: string } }

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(['memory']),
	bindings: {},
	readAccess: () => true,
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	scoped: true,
	resolveScope: async () => 'alpha',
	member: () => true,
	...overrides,
})

const reqWith = (runtime: AnalyticsRuntime, url: string): PayloadRequest => {
	const payload = { logger: { warn: vi.fn(), error: vi.fn() } } as unknown as Payload
	setRuntime(payload, runtime)
	return { user: { id: 1 }, payload, url } as unknown as PayloadRequest
}

/**
 * The scope selector sends whatever the reader picked; the refusal has to come from the
 * server's own gate, not from the client having hidden the control.
 */
describe('makeRealtimeHandler scope gating', () => {
	const denied = runtimeWith({ crossScope: allCrossScope(async () => false) })

	it('refuses the cross-scope wildcard from a reader crossScope denies', async () => {
		const res = await makeRealtimeHandler()(reqWith(denied, '/api/_x/live?scope=*'))

		expect(res.status).toBe(400)
		const { error } = (await res.json()) as ErrorBody
		expect(error.code).toBe('untrusted_scope')
		expect(error.param).toBe('scope')
	})

	it("refuses another tenant's scope from the same reader", async () => {
		const res = await makeRealtimeHandler()(reqWith(denied, '/api/_x/live?scope=beta'))

		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('untrusted_scope')
	})

	// The widget links carry the scope their read resolved to; a tenant admin following one
	// has to land on the view rather than on a refusal for naming their own tenant.
	it('lets a denied reader name the scope it already resolves to', async () => {
		const res = await makeRealtimeHandler()(reqWith(denied, '/api/_x/live?scope=alpha'))

		expect(res.status).not.toBe(400)
	})

	it('lets a platform reader through to the read', async () => {
		const runtime = runtimeWith({ crossScope: allCrossScope(async () => true) })
		const res = await makeRealtimeHandler()(reqWith(runtime, '/api/_x/live?scope=beta'))

		expect(res.status).not.toBe(400)
	})

	it('leaves a request that names no scope to its own resolver', async () => {
		const res = await makeRealtimeHandler()(reqWith(denied, '/api/_x/live'))

		expect(res.status).not.toBe(400)
	})

	it('refuses a tenant the reader selected without belonging to it', async () => {
		const stranger = runtimeWith({
			member: () => false,
			crossScope: allCrossScope(async () => false),
		})
		const own = await makeRealtimeHandler()(reqWith(stranger, '/api/_x/live'))
		const named = await makeRealtimeHandler()(reqWith(stranger, '/api/_x/live?scope=alpha'))

		expect(own.status).toBe(400)
		expect(named.status).toBe(400)
		expect(((await named.json()) as ErrorBody).error.code).toBe('untrusted_scope')
	})

	it('answers 403 to a reader access.read denies, before anything else', async () => {
		const closed = runtimeWith({ readAccess: () => false })
		const res = await makeRealtimeHandler()(reqWith(closed, '/api/_x/live?scope=beta'))

		expect(res.status).toBe(403)
	})
})

const counting = (seen: AnalyticsQuery[]): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'native',
		capabilities: { ...base.capabilities, scopedQueries: true },
		isConfigured: () => true,
		realtime: async (query: AnalyticsQuery): Promise<AnalyticsResult> => {
			seen.push(query)
			return { rows: [], totals: { visitors: 3 }, meta: { provider: 'native', fetchedAt: '' } }
		},
	}
}

const documentReq = (args: {
	seen: AnalyticsQuery[]
	tenant: string
	named: boolean
}): PayloadRequest => {
	const kv = new Map<string, unknown>()
	const payload = {
		logger: { warn: vi.fn(), error: vi.fn() },
		findByID: async () => ({ id: 'p1', slug: '/home', tenant: args.tenant }),
		kv: {
			get: async (key: string) => kv.get(key) ?? null,
			set: async (key: string, value: unknown) => {
				kv.set(key, value)
			},
			delete: async (key: string) => {
				kv.delete(key)
			},
		},
	} as unknown as Payload
	setRuntime(
		payload,
		runtimeWith({
			registry: createRegistry([counting(args.seen)]),
			configAdapterIds: new Set(['native']),
			bindings: { pages: { pathField: 'slug', scopeField: 'tenant' } },
			crossScope: allCrossScope(() => args.named),
		})
	)
	return {
		user: { id: 1 },
		payload,
		url: '/api/_x/live?collection=pages&id=p1',
	} as unknown as PayloadRequest
}

/**
 * The counter belongs to the page it is drawn on. Before this it resolved the reader's own
 * scope, so platform staff on one tenant's page watched another tenant's visitors tick.
 */
describe('makeRealtimeHandler document scope', () => {
	it("counts the document's own tenant for platform staff, not the reader's", async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeRealtimeHandler()(documentReq({ seen, tenant: 'beta', named: true }))

		expect(res.status).toBe(200)
		expect(seen[0]?.scope).toBe('beta')
	})

	it('refuses a document whose tenant the reader may not name', async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeRealtimeHandler()(documentReq({ seen, tenant: 'beta', named: false }))

		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('untrusted_scope')
		expect(seen).toEqual([])
	})

	it("counts the reader's own tenant when the page is theirs", async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeRealtimeHandler()(documentReq({ seen, tenant: 'alpha', named: false }))

		expect(res.status).toBe(200)
		expect(seen[0]?.scope).toBe('alpha')
	})
})

describe('makeRealtimeHandler failed reads', () => {
	const failing = (err: Error): AnalyticsAdapter => {
		const base = memoryAdapter()
		return {
			...base,
			capabilities: { ...base.capabilities, scopedQueries: true },
			realtime: async () => {
				throw err
			},
		}
	}

	const answerTo = (err: Error) =>
		makeRealtimeHandler()(
			reqWith(runtimeWith({ registry: createRegistry([failing(err)]) }), '/api/_x/live')
		)

	it('answers a source whose setup is wrong 502, without Retry-After', async () => {
		const res = await answerTo(new ProviderHttpError(401, 'memory', 'bad key'))
		expect(res.status).toBe(502)
		expect(((await res.json()) as ErrorBody).error).toMatchObject({
			code: 'source_misconfigured',
			param: 'source',
		})
		expect(res.headers.get('Retry-After')).toBeNull()
	})

	it('answers an outage 503 with the wait the source asked for', async () => {
		const res = await answerTo(
			new ProviderHttpError(503, 'memory', { message: 'down', retryAfterMs: 5_000 })
		)
		expect(res.status).toBe(503)
		expect(((await res.json()) as ErrorBody).error.code).toBe('unavailable')
		expect(res.headers.get('Retry-After')).toBe('5')
	})
})
