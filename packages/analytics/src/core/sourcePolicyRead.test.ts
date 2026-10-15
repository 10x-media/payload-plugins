import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { SYSTEM } from '../access/principal'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import type { AnalyticsAdapter } from './contract'
import { type AdapterRegistry, createRegistry, type ScopeRegistry } from './registry'
import {
	resolveReadContext,
	resolveRequestedScope,
	systemRegistryFor,
	visibleRegistryFor,
	visibleSourcesFor,
} from './scopedRead'
import type { DefaultSourceFunction, SourcePolicy } from './sourcePolicy'

const caps = memoryAdapter().capabilities
/** The platform's shared adapter, narrowing each query to one tenant (PostHog's `scopeProperty`). */
const shared: AnalyticsAdapter = {
	...memoryAdapter(),
	id: 'posthog',
	label: 'Platform',
	capabilities: { ...caps, scopedQueries: true },
}
/** A shared adapter that cannot narrow: it would answer with every tenant's numbers. */
const wide = memoryAdapter()
/** A source the tenant's own provider document adds. */
const own: AnalyticsAdapter = { ...memoryAdapter(), id: 'plausible:doc-1', label: 'Own site' }

const ids = (registry: AdapterRegistry | null) => registry?.all().map((adapter) => adapter.id)

const staffOnly = ({ req }: { req: PayloadRequest }) =>
	(req.user as { role?: string } | null)?.role === 'staff'

const runtimeWith = (
	policy: SourcePolicy | undefined,
	over: Partial<AnalyticsRuntime> = {}
): AnalyticsRuntime => ({
	registry: createRegistry([shared, wide]),
	configAdapterIds: new Set(['posthog', 'memory']),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	scoped: true,
	readAccess: () => true,
	resolveScope: async () => 'alpha',
	member: ({ scope }) => scope === 'alpha',
	crossScope: { named: () => false, aggregate: () => false, unscopedSource: staffOnly },
	providersCollection: {
		slug: 'analytics-providers',
		scopeField: 'tenant',
		sourceAccess: () => true,
	},
	...(policy === undefined || policy === 'staff'
		? {}
		: { sourcePolicies: new Map([['posthog', policy]]) }),
	...over,
})

/** A reader whose readable provider documents are `docs`; fresh per call, as decisions memoize per request. */
const readerReq = (docs: string[] = [], role = 'tenant') => {
	const warn = vi.fn()
	const req = {
		user: { id: 1, collection: 'users', role },
		payload: {
			config: { admin: { user: 'users' } },
			logger: { warn },
			find: vi.fn(async () => ({ docs: docs.map((id) => ({ id })) })),
		},
	} as unknown as PayloadRequest
	return { req, warn }
}

const withOwn = (over: Partial<ScopeRegistry> = {}): ScopeRegistry => ({
	registry: createRegistry([shared, wide, own]),
	grants: new Map([['plausible:doc-1', 'doc-1']]),
	...over,
})
const withoutOwn = (): ScopeRegistry => ({
	registry: createRegistry([shared, wide]),
	grants: new Map(),
})

describe('sources.<id>.tenants', () => {
	it('keeps the shared adapter platform staff only without a policy, as before', async () => {
		const runtime = runtimeWith(undefined)
		const tenant = readerReq()
		expect(
			await visibleRegistryFor({ runtime, req: tenant.req, resolved: withoutOwn(), scope: 'alpha' })
		).toBeNull()
		const staff = readerReq([], 'staff')
		expect(
			ids(
				await visibleRegistryFor({
					runtime,
					req: staff.req,
					resolved: withoutOwn(),
					scope: 'alpha',
				})
			)
		).toEqual(['posthog', 'memory'])
	})

	it('lets `tenant` members read it beside their own sources, narrowed to their tenant', async () => {
		const runtime = runtimeWith('tenant', { resolveRegistry: async () => withOwn() })
		const { req } = readerReq(['doc-1'])
		const listed = await visibleSourcesFor({ runtime, req, resolved: withOwn(), scope: 'alpha' })
		expect(ids(listed.registry)).toEqual(['posthog', 'plausible:doc-1'])
		expect(listed.fallbackAdmitted.size).toBe(0)
		const ctx = await resolveReadContext({
			runtime,
			req: readerReq(['doc-1']).req,
			adapterId: 'posthog',
		})
		expect(ctx.ok && ctx.queryScope).toBe('alpha')
		expect(ctx.ok && ctx.adapter.id).toBe('posthog')
	})

	it('admits nobody to a scope they are no member of', async () => {
		const runtime = runtimeWith('tenant')
		const { req } = readerReq()
		expect(
			await visibleRegistryFor({ runtime, req, resolved: withoutOwn(), scope: 'beta' })
		).toBeNull()
	})

	it('lets `fallback` members read it only while their own readable sources are none', async () => {
		const runtime = runtimeWith('fallback')
		const alone = await visibleSourcesFor({
			runtime,
			req: readerReq().req,
			resolved: withoutOwn(),
			scope: 'alpha',
		})
		expect(ids(alone.registry)).toEqual(['posthog'])
		expect([...alone.fallbackAdmitted]).toEqual(['posthog'])

		const owning = await visibleSourcesFor({
			runtime,
			req: readerReq(['doc-1']).req,
			resolved: withOwn(),
			scope: 'alpha',
		})
		expect(ids(owning.registry)).toEqual(['plausible:doc-1'])
		expect(owning.fallbackAdmitted.size).toBe(0)

		// A document the reader may not read is not a source of theirs.
		const unreadable = await visibleSourcesFor({
			runtime,
			req: readerReq([]).req,
			resolved: withOwn(),
			scope: 'alpha',
		})
		expect(ids(unreadable.registry)).toEqual(['posthog'])
	})

	it('never flags a staff reader as reading through the fallback', async () => {
		const runtime = runtimeWith('fallback')
		const listed = await visibleSourcesFor({
			runtime,
			req: readerReq([], 'staff').req,
			resolved: withoutOwn(),
			scope: 'alpha',
		})
		expect(ids(listed.registry)).toEqual(['posthog', 'memory'])
		expect(listed.fallbackAdmitted.size).toBe(0)
	})

	it('asks a policy function once per request, scope and adapter, handing it the own sources', async () => {
		const policy = vi.fn(() => true)
		const runtime = runtimeWith(policy)
		const { req } = readerReq(['doc-1'])
		for (let i = 0; i < 3; i++) {
			expect(
				ids(await visibleRegistryFor({ runtime, req, resolved: withOwn(), scope: 'alpha' }))
			).toEqual(['posthog', 'plausible:doc-1'])
		}
		expect(policy).toHaveBeenCalledTimes(1)
		expect(policy).toHaveBeenCalledWith({
			req,
			scope: 'alpha',
			adapterId: 'posthog',
			ownSources: [{ id: 'plausible:doc-1', label: 'Own site', docId: 'doc-1' }],
		})
	})

	it('counts a policy function that throws as no, and says so', async () => {
		const runtime = runtimeWith(() => {
			throw new Error('boom')
		})
		const { req, warn } = readerReq()
		expect(
			await visibleRegistryFor({ runtime, req, resolved: withoutOwn(), scope: 'alpha' })
		).toBeNull()
		expect(warn.mock.calls[0]?.[0]).toMatch(/sources\.posthog\.tenants threw for scope "alpha"/)
	})

	// The boot refuses this; a runtime built by hand must not open install-wide totals either.
	it('never admits a tenant through an adapter that cannot narrow', async () => {
		const runtime = runtimeWith(undefined, { sourcePolicies: new Map([['memory', 'tenant']]) })
		expect(
			await visibleRegistryFor({
				runtime,
				req: readerReq().req,
				resolved: withoutOwn(),
				scope: 'alpha',
			})
		).toBeNull()
	})

	// Warm and sync read as SYSTEM: the scope's own sources and every shared one that narrows,
	// whatever a tenant user may see, and never one that would answer with every tenant's numbers.
	it.each([
		['staff', undefined],
		['tenant', 'tenant'],
		['fallback', 'fallback'],
	] as const)('leaves the sources jobs read through alone under %s', async (_name, policy) => {
		const runtime = runtimeWith(policy, { resolveRegistry: async () => withOwn() })
		const { req } = readerReq()
		expect(ids(await systemRegistryFor(runtime, req, 'alpha'))).toEqual([
			'posthog',
			'plausible:doc-1',
		])
	})

	it('never asks a policy function about a job', async () => {
		const policy = vi.fn(() => false)
		const runtime = runtimeWith(policy, { resolveRegistry: async () => withoutOwn() })
		expect(ids(await systemRegistryFor(runtime, readerReq().req, 'alpha'))).toEqual(['posthog'])
		expect(policy).not.toHaveBeenCalled()
	})
})

describe('a tenant scope default', () => {
	const tenantRuntime = (over: Partial<AnalyticsRuntime> = {}) =>
		runtimeWith('tenant', { platformAdapterId: 'posthog', ...over })
	const defaultOf = async (runtime: AnalyticsRuntime, resolved: ScopeRegistry) =>
		(
			await visibleRegistryFor({ runtime, req: readerReq(['doc-1']).req, resolved, scope: 'alpha' })
		)?.default().id

	it('keeps the registry order without a flagged document or a rule', async () => {
		const resolved = withOwn()
		const visible = await visibleRegistryFor({
			runtime: tenantRuntime(),
			req: readerReq(['doc-1']).req,
			resolved,
			scope: 'alpha',
		})
		expect(visible?.default().id).toBe('posthog')
	})

	it('reads through the document flagged the default, over any rule', async () => {
		const runtime = tenantRuntime({ defaultSource: 'platformFirst' })
		expect(await defaultOf(runtime, withOwn({ defaultGrant: 'plausible:doc-1' }))).toBe(
			'plausible:doc-1'
		)
	})

	it('passes over a flagged document the reader cannot read', async () => {
		const runtime = tenantRuntime({ defaultSource: 'platformFirst' })
		const resolved = withOwn({ defaultGrant: 'plausible:doc-1' })
		const visible = await visibleRegistryFor({
			runtime,
			req: readerReq([]).req,
			resolved,
			scope: 'alpha',
		})
		expect(visible?.default().id).toBe('posthog')
	})

	it('puts the scope own source first under tenantFirst', async () => {
		expect(await defaultOf(tenantRuntime({ defaultSource: 'tenantFirst' }), withOwn())).toBe(
			'plausible:doc-1'
		)
	})

	it('puts the platform adapter first under platformFirst', async () => {
		const resolved = withOwn({ registry: createRegistry([own, shared, wide]) })
		expect(await defaultOf(tenantRuntime({ defaultSource: 'platformFirst' }), resolved)).toBe(
			'posthog'
		)
	})

	it('reads the id a function picks, and ignores one the reader cannot read', async () => {
		const pick = vi.fn<DefaultSourceFunction>(() => 'plausible:doc-1')
		expect(await defaultOf(tenantRuntime({ defaultSource: pick }), withOwn())).toBe(
			'plausible:doc-1'
		)
		expect(pick.mock.calls[0]?.[0]).toMatchObject({
			scope: 'alpha',
			sources: [
				{ id: 'posthog', label: 'Platform', kind: 'config' },
				{ id: 'plausible:doc-1', label: 'Own site', kind: 'runtime', docId: 'doc-1' },
			],
		})
		expect(await defaultOf(tenantRuntime({ defaultSource: () => 'memory' }), withOwn())).toBe(
			'posthog'
		)
	})

	it('picks the same default for a job', async () => {
		const runtime = tenantRuntime({
			defaultSource: 'tenantFirst',
			resolveRegistry: async () => withOwn(),
		})
		expect((await systemRegistryFor(runtime, readerReq().req, 'alpha'))?.default().id).toBe(
			'plausible:doc-1'
		)
	})

	it('leaves install-wide and cross-scope reads to the registry', async () => {
		const runtime = tenantRuntime({ defaultSource: 'tenantFirst' })
		const resolved = withOwn()
		for (const scope of [null, '*']) {
			const visible = await visibleRegistryFor({
				runtime,
				req: readerReq().req,
				resolved,
				scope,
			})
			expect(visible).toBe(resolved.registry)
		}
	})
})

describe('the scope each cross-scope gate is asked about', () => {
	it('names the scope a read asks for, the wildcard for every scope, and the shared adapter', async () => {
		const named = vi.fn(() => true)
		const aggregate = vi.fn(() => true)
		const unscopedSource = vi.fn(() => true)
		const runtime = runtimeWith(undefined, { crossScope: { named, aggregate, unscopedSource } })
		expect((await resolveRequestedScope({ runtime, req: readerReq().req, raw: 'beta' })).ok).toBe(
			true
		)
		expect(named).toHaveBeenCalledWith(expect.objectContaining({ scope: 'beta' }))
		expect((await resolveRequestedScope({ runtime, req: readerReq().req, raw: '*' })).ok).toBe(true)
		expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ scope: '*' }))
		await visibleRegistryFor({
			runtime,
			req: readerReq().req,
			resolved: withoutOwn(),
			scope: 'alpha',
		})
		expect(unscopedSource).toHaveBeenCalledWith(
			expect.objectContaining({ scope: 'alpha', adapterId: 'memory' })
		)
	})
})

describe('resolveReadContext fallbackWhenUnreadable', () => {
	const runtime = runtimeWith('fallback', {
		resolveRegistry: async () => withOwn({ defaultGrant: 'plausible:doc-1' }),
	})

	it('reads the scope default for a stored source the reader cannot read, naming it', async () => {
		const ctx = await resolveReadContext({
			runtime,
			req: readerReq(['doc-1']).req,
			adapterId: 'posthog',
			fallbackWhenUnreadable: true,
		})
		expect(ctx.ok && ctx.adapter.id).toBe('plausible:doc-1')
		expect(ctx.ok && ctx.substitutedFrom).toBe('posthog')
		expect(ctx.ok && ctx.queryScope).toBe('alpha')
	})

	it('refuses the same source when the caller named it explicitly', async () => {
		const ctx = await resolveReadContext({
			runtime,
			req: readerReq(['doc-1']).req,
			adapterId: 'posthog',
		})
		expect(ctx.ok).toBe(false)
	})

	it('substitutes nothing for a source the reader can read', async () => {
		const ctx = await resolveReadContext({
			runtime,
			req: readerReq(['doc-1']).req,
			adapterId: 'plausible:doc-1',
			fallbackWhenUnreadable: true,
		})
		expect(ctx.ok && ctx.adapter.id).toBe('plausible:doc-1')
		expect(ctx.ok && 'substitutedFrom' in ctx).toBe(false)
	})

	it('substitutes for a job reading a source no longer in its scope', async () => {
		const ctx = await resolveReadContext({
			runtime,
			req: readerReq().req,
			principal: SYSTEM,
			scope: 'alpha',
			adapterId: 'memory',
			fallbackWhenUnreadable: true,
		})
		expect(ctx.ok && ctx.adapter.id).toBe('plausible:doc-1')
		expect(ctx.ok && ctx.substitutedFrom).toBe('memory')
	})
})
