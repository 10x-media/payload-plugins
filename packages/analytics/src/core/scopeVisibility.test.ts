import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { SYSTEM } from '../access/principal'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { createRegistry } from './registry'
import { resolveRequestedScope, visibleRegistryFor } from './scopedRead'

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: { aggregate: 3600, realtime: 300 },
	comparison: true,
	...overrides,
})

const tenantReq = { payload: {}, user: { id: 1 } } as unknown as PayloadRequest
const deny = () => false
const allow = () => true

describe('resolveRequestedScope access.scopes', () => {
	const scoped = (over: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime =>
		runtimeWith({ scoped: true, resolveScope: async () => 'alpha', member: allow, ...over })

	it('refuses another tenant to a reader without `named`', async () => {
		const runtime = scoped({
			crossScope: { named: deny, aggregate: allow, unscopedSource: allow },
		})
		const other = await resolveRequestedScope({ runtime, req: tenantReq, raw: 'beta' })
		expect(other.ok).toBe(false)
		expect(other.ok === false && other.reason).toBe('named')
	})

	// Aggregating over every tenant and singling one out are different privileges: a reader
	// granted the first must not thereby be able to read one tenant they do not belong to.
	it('does not let `aggregate` alone grant naming another tenant', async () => {
		const runtime = scoped({
			crossScope: { named: deny, aggregate: allow, unscopedSource: deny },
		})
		expect((await resolveRequestedScope({ runtime, req: tenantReq, raw: '*' })).ok).toBe(true)
		expect((await resolveRequestedScope({ runtime, req: tenantReq, raw: 'beta' })).ok).toBe(false)
	})

	it('lets every reader name the scope they already resolve to', async () => {
		const runtime = scoped({
			crossScope: { named: deny, aggregate: deny, unscopedSource: deny },
		})
		const own = await resolveRequestedScope({ runtime, req: tenantReq, raw: 'alpha' })
		expect(own.ok && own.scope).toBe('alpha')
	})

	it('gates the wildcard behind `aggregate` rather than `named`', async () => {
		const runtime = scoped({
			crossScope: { named: allow, aggregate: deny, unscopedSource: allow },
		})
		expect((await resolveRequestedScope({ runtime, req: tenantReq, raw: '*' })).ok).toBe(false)
	})
})

describe('visibleRegistryFor', () => {
	const shared = memoryAdapter()
	const nativeLike = {
		...memoryAdapter(),
		id: 'native',
		capabilities: { ...memoryAdapter().capabilities, scopedQueries: true },
	}
	const registry = createRegistry([nativeLike, shared])

	const withCollection = (over: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime =>
		runtimeWith({
			scoped: true,
			configAdapterIds: new Set(['native', 'memory']),
			providersCollection: { slug: 'analytics-providers', scopeField: 'tenant' },
			...over,
		})

	it('hides every config adapter from a tenant without `unscopedSource`', async () => {
		const visible = await visibleRegistryFor({
			runtime: withCollection({
				crossScope: { named: deny, aggregate: deny, unscopedSource: deny },
			}),
			req: tenantReq,
			resolved: { registry, grants: new Map() },
			scope: 'alpha',
		})
		expect(visible).toBeNull()
	})

	it('shows them to a reader `unscopedSource` allows', async () => {
		const visible = await visibleRegistryFor({
			runtime: withCollection({
				crossScope: { named: deny, aggregate: deny, unscopedSource: allow },
			}),
			req: tenantReq,
			resolved: { registry, grants: new Map() },
			scope: 'alpha',
		})
		expect(visible?.all().map((a) => a.id)).toEqual(['native', 'memory'])
	})

	// Without a providers collection nothing can grant anything, so a config adapter that can
	// narrow to the scope stays open to every reader.
	it('keeps a scope-filterable config adapter open when no providers collection exists', async () => {
		const visible = await visibleRegistryFor({
			runtime: runtimeWith({
				scoped: true,
				configAdapterIds: new Set(['native', 'memory']),
				crossScope: { named: deny, aggregate: deny, unscopedSource: deny },
			}),
			req: tenantReq,
			resolved: { registry, grants: new Map() },
			scope: 'alpha',
		})
		expect(visible?.all().map((a) => a.id)).toEqual(['native'])
	})

	it('leaves an install-wide read alone', async () => {
		const visible = await visibleRegistryFor({
			runtime: withCollection({
				crossScope: { named: deny, aggregate: deny, unscopedSource: deny },
			}),
			req: tenantReq,
			resolved: { registry, grants: new Map() },
			scope: null,
		})
		expect(visible?.all()).toHaveLength(2)
	})

	// A job has no user to ask about: the system reads every document the scope holds, and
	// never a shared adapter that would answer with every tenant's numbers.
	it("gives the system principal every source the scope's documents grant, unread", async () => {
		const find = vi.fn()
		const jobReq = { payload: { find }, user: null } as unknown as PayloadRequest
		const visible = await visibleRegistryFor({
			runtime: withCollection({
				crossScope: { named: allow, aggregate: allow, unscopedSource: allow },
			}),
			req: jobReq,
			resolved: { registry, grants: new Map([['native', 'doc-1']]) },
			scope: 'alpha',
			principal: SYSTEM,
		})
		expect(visible?.all().map((a) => a.id)).toEqual(['native'])
		expect(find).not.toHaveBeenCalled()
	})

	// A shared source that narrows to the tenant answers for that tenant alone, whoever owns it.
	it('lets the system principal read a shared source that narrows to the scope', async () => {
		const visible = await visibleRegistryFor({
			runtime: withCollection(),
			req: tenantReq,
			resolved: { registry, grants: new Map() },
			scope: 'alpha',
			principal: SYSTEM,
		})
		expect(visible?.all().map((a) => a.id)).toEqual(['native'])
	})
})
