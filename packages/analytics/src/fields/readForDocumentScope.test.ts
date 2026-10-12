import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { SYSTEM } from '../access/principal'
import type { DocumentScopeField } from '../binding/types'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, getRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForField } from './readForDocument'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const recording = (seen: AnalyticsQuery[]): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'native',
		capabilities: { ...base.capabilities, scopedQueries: true },
		isConfigured: () => true,
		async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
			seen.push(q)
			return { rows: [], totals: { pageviews: 1 }, meta: { provider: 'native', fetchedAt: '' } }
		},
	}
}

const reqFor = (
	adapter: AnalyticsAdapter,
	named = true,
	scopeField: DocumentScopeField = 'tenant'
): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: { pages: { pathField: 'slug', scopeField } },
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
		scoped: true,
		resolveScope: async () => 'beta',
		member: () => true,
		// Reading a page of a tenant that is not the request's own is `access.crossScope.named`,
		// so these read as platform staff unless a case says otherwise.
		crossScope: allCrossScope(() => named),
	})
	return { payload } as PayloadRequest
}

/** {@link reqFor} with part of its runtime replaced. */
const reqWith = (adapter: AnalyticsAdapter, over: Partial<AnalyticsRuntime>): PayloadRequest => {
	const req = reqFor(adapter, false)
	const runtime = getRuntime(req.payload)
	if (runtime) {
		Object.assign(runtime, over)
	}
	return req
}

const read = (req: PayloadRequest, over: Record<string, unknown> = {}) =>
	readForField({
		req,
		collectionSlug: 'pages',
		data: { id: 'p1', slug: 'home', tenant: 'alpha' },
		metrics: ['pageviews'],
		timeframe: 'last7days',
		now: NOW,
		...over,
	})

describe('readForField document scope', () => {
	// A page belonging to alpha must never report beta's numbers because the reader has beta
	// selected.
	it("reads the document's own scope rather than the request's", async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen))
		await read(req)
		expect(seen[0]?.scope).toBe('alpha')
	})

	it('falls back to the request scope when the document names none', async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen))
		await read(req, { data: { id: 'p1', slug: 'home' } })
		expect(seen[0]?.scope).toBe('beta')
	})

	it("reads the request scope when the binding's scopeField is false", async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen), true, false)
		await read(req)
		expect(seen[0]?.scope).toBe('beta')
	})

	it('reads the field the binding names', async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen), true, 'site')
		await read(req, { data: { id: 'p1', slug: 'home', tenant: 'alpha', site: 'gamma' } })
		expect(seen[0]?.scope).toBe('gamma')
	})

	// Defence in depth behind the collection's own field name: whatever let this reader open the
	// document, reading another tenant's numbers out of it is still `access.crossScope.named`.
	it('refuses a document scope the reader may not read across into', async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen), false)
		const result = await read(req)
		expect(result.status).toBe('no-access')
		expect(result.untrustedScope).toBe(true)
		expect(seen).toEqual([])
	})

	it('lets the system principal name a scope over the document', async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqFor(recording(seen), false)
		await read(req, { principal: SYSTEM, scope: 'gamma' })
		expect(seen[0]?.scope).toBe('gamma')
	})

	it('says no-access to a reader access.read denies, without reading', async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqWith(recording(seen), { readAccess: () => false })
		const result = await read(req, { data: { id: 'p1', slug: 'home' } })
		expect(result.status).toBe('no-access')
		expect(seen).toEqual([])
	})

	// A page with no tenant of its own reads the request's, and a selector naming a tenant the
	// user does not belong to is refused there exactly as a named one would be.
	it("refuses the request's own scope when its user does not belong to it", async () => {
		const seen: AnalyticsQuery[] = []
		const req = reqWith(recording(seen), { member: () => false })
		const result = await read(req, { data: { id: 'p1', slug: 'home' } })
		expect(result.status).toBe('no-access')
		expect(result.untrustedScope).toBe(true)
		expect(seen).toEqual([])
	})
})

describe('readForField no-access', () => {
	/** A reader who may read the document but none of its tenant's sources. */
	const closedReq = (): PayloadRequest => {
		const req = reqFor(recording([]))
		const runtime = getRuntime(req.payload)
		if (runtime) {
			runtime.providersCollection = { slug: 'analytics-providers', scopeField: 'tenant' }
			runtime.crossScope = {
				// The reader may name the page's tenant; what they hold none of is its sources.
				named: () => true,
				aggregate: () => false,
				unscopedSource: () => false,
			}
			runtime.resolveRegistry = async () => ({
				registry: createRegistry([recording([])]),
				grants: new Map([['native', 'doc-beta']]),
			})
			;(req.payload as { find?: unknown }).find = async () => ({ docs: [] })
		}
		return req
	}

	// Another tenant's page must not read as a page with no traffic yet, the one thing it is not.
	it('says so when the document scope holds no source this reader may read', async () => {
		const result = await read(closedReq())
		expect(result.status).toBe('no-access')
		// Nothing to poll: the live counter renders only on an `ok` read that reports realtime.
		expect(result.realtime).toBeUndefined()
	})

	it('stays unavailable when the document names no scope of its own', async () => {
		const result = await read(closedReq(), { data: { id: 'p1', slug: 'home' } })
		expect(result.status).toBe('unavailable')
	})
})
