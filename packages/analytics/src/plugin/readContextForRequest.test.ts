import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveSourcesForRequest } from './readContextForRequest'
import { type AnalyticsRuntime, setRuntime } from './runtime'

const withId = (id: string, scopedQueries: boolean): AnalyticsAdapter => {
	const base = memoryAdapter()
	return { ...base, id, label: id, capabilities: { ...base.capabilities, scopedQueries } }
}

/** The scope's own source, and the platform's shared one that answers install-wide whatever is asked. */
const tenantSource = withId('native', true)
const platformSource = withId('platform', false)

/** A platform reader: every cross-scope gate open, so nothing here is an access refusal. */
const reqFor = (scope: string | null): PayloadRequest => {
	const registry = createRegistry([tenantSource, platformSource], 'platform')
	const payload = {
		logger: { warn: () => {} },
		find: async () => ({ docs: [{ id: 'doc-native' }] }),
	} as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry,
		resolveRegistry: async () => ({
			registry,
			grants: new Map([['native', 'doc-native']]),
		}),
		resolveScope: async () => scope,
		scoped: true,
		providersCollection: { slug: 'analytics-providers', scopeField: 'tenant' },
		configAdapterIds: new Set(['native', 'platform']),
		crossScope: { named: () => true, aggregate: () => true, unscopedSource: () => true },
		bindings: {},
		readAccess: () => true,
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: true,
	})
	return { payload, user: { id: 1 } } as unknown as PayloadRequest
}

describe('resolveSourcesForRequest scope narrowing', () => {
	// Listed under a tenant caption, the platform's shared source would answer "Showing: Alpha"
	// with every tenant's numbers.
	it('offers a tenant only the sources that can narrow to it', async () => {
		const listing = await resolveSourcesForRequest(reqFor('alpha'))
		expect(listing.sources.map((source) => source.id)).toEqual(['native'])
		// The configured default could not narrow either, so the listing leads with what is left.
		expect(listing.defaultId).toBe('native')
		expect(listing.scope).toBe('alpha')
	})

	it('keeps every readable source for an aggregate read', async () => {
		const listing = await resolveSourcesForRequest(reqFor('*'))
		expect(listing.sources.map((source) => source.id)).toEqual(['native', 'platform'])
		expect(listing.defaultId).toBe('platform')
	})

	it('keeps every readable source when no scope resolves', async () => {
		const listing = await resolveSourcesForRequest(reqFor(null))
		expect(listing.sources.map((source) => source.id)).toEqual(['native', 'platform'])
	})
})

describe('resolveSourcesForRequest source policies', () => {
	const shared = withId('posthog', true)
	const own = withId('plausible:doc-1', false)

	/** A member of `alpha` who is not platform staff, reading `docs` of its own. */
	const tenantReq = (over: Partial<AnalyticsRuntime>, docs: string[]): PayloadRequest => {
		const registry = createRegistry(docs.length > 0 ? [shared, own] : [shared])
		const payload = {
			logger: { warn: () => {} },
			find: async () => ({ docs: docs.map((id) => ({ id })) }),
		} as unknown as PayloadRequest['payload']
		setRuntime(payload, {
			registry,
			resolveRegistry: async () => ({
				registry,
				grants: new Map(docs.map((id) => [`plausible:${id}`, id])),
			}),
			resolveScope: async () => 'alpha',
			member: ({ scope }) => scope === 'alpha',
			scoped: true,
			providersCollection: { slug: 'analytics-providers', scopeField: 'tenant' },
			configAdapterIds: new Set(['posthog']),
			crossScope: { named: () => false, aggregate: () => false, unscopedSource: () => false },
			bindings: {},
			readAccess: () => true,
			engine: { read: async (adapter, query) => adapter.query(query, {}) },
			ttl: {},
			comparison: true,
			...over,
		})
		return { payload, user: { id: 1 } } as unknown as PayloadRequest
	}

	it('lists nothing to a tenant without a policy, as before', async () => {
		const listing = await resolveSourcesForRequest(tenantReq({}, []))
		expect(listing.sources).toEqual([])
		expect(listing.notice).toBeUndefined()
	})

	it('says when the shared source is listed only as the fallback', async () => {
		const fallback = { sourcePolicies: new Map([['posthog', 'fallback' as const]]) }
		const alone = await resolveSourcesForRequest(tenantReq(fallback, []))
		expect(alone.sources.map((source) => source.id)).toEqual(['posthog'])
		expect(alone.notice).toBe('platformFallback')
		const owning = await resolveSourcesForRequest(tenantReq(fallback, ['doc-1']))
		expect(owning.sources.map((source) => source.id)).toEqual(['plausible:doc-1'])
		expect(owning.notice).toBeUndefined()
	})

	it('lists a tenant policy without a notice, defaulting where defaultSource points', async () => {
		const listing = await resolveSourcesForRequest(
			tenantReq(
				{ sourcePolicies: new Map([['posthog', 'tenant' as const]]), defaultSource: 'tenantFirst' },
				['doc-1']
			)
		)
		expect(listing.sources.map((source) => source.id)).toEqual(['posthog', 'plausible:doc-1'])
		expect(listing.defaultId).toBe('plausible:doc-1')
		expect(listing.notice).toBeUndefined()
	})
})
