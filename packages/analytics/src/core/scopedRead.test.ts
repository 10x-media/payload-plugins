import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { createRegistry } from './registry'
import { resolveReadContext } from './scopedRead'

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: { aggregate: 3600, realtime: 300 },
	comparison: true,
	...overrides,
})

const req = { payload: {} } as PayloadRequest

describe('resolveReadContext', () => {
	it('resolves the default adapter with a null scope when no resolvers exist', async () => {
		const ctx = await resolveReadContext({ runtime: runtimeWith(), req })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.adapter.id).toBe('memory')
			expect(ctx.scope).toBeNull()
			expect(ctx.queryScope).toBeUndefined()
		}
	})

	it('resolves scope from the runtime scope resolver and stamps queryScope', async () => {
		const runtime = runtimeWith({ resolveScope: async () => 'tenant-a' })
		const ctx = await resolveReadContext({ runtime, req })
		expect(ctx.ok && ctx.scope).toBe('tenant-a')
		expect(ctx.ok && ctx.queryScope).toBe('tenant-a')
	})

	it('prefers an explicit scope over the resolved one, including explicit null', async () => {
		const runtime = runtimeWith({ resolveScope: async () => 'tenant-a' })
		const explicit = await resolveReadContext({ runtime, req, scope: 'tenant-b' })
		expect(explicit.ok && explicit.scope).toBe('tenant-b')
		const nulled = await resolveReadContext({ runtime, req, scope: null })
		expect(nulled.ok && nulled.scope).toBeNull()
	})

	it('passes the scope to the registry resolver', async () => {
		const scopes: Array<string | null> = []
		const registry = createRegistry([memoryAdapter()])
		const runtime = runtimeWith({
			resolveScope: async () => 't1',
			resolveRegistry: async ({ scope }) => {
				scopes.push(scope)
				return registry
			},
		})
		await resolveReadContext({ runtime, req })
		expect(scopes).toEqual(['t1'])
	})

	it('degrades to not-ok for an unknown adapter id', async () => {
		const ctx = await resolveReadContext({ runtime: runtimeWith(), req, adapterId: 'nope' })
		expect(ctx.ok).toBe(false)
	})

	it('degrades to not-ok when the scope resolver throws', async () => {
		const runtime = runtimeWith({
			resolveScope: async () => {
				throw new Error('boom')
			},
		})
		const ctx = await resolveReadContext({ runtime, req })
		expect(ctx.ok).toBe(false)
	})
})

describe('resolveReadContext platform gating', () => {
	const userReq = { payload: {}, user: { id: 1 } } as unknown as PayloadRequest
	const anonReq = { payload: {}, user: null } as unknown as PayloadRequest

	const scopedAdapter = () => {
		const adapter = memoryAdapter()
		return { ...adapter, capabilities: { ...adapter.capabilities, scopedQueries: true } }
	}

	it("gates an explicit '*' read behind platformRead and strips the query scope", async () => {
		const runtime = runtimeWith()
		const allowed = await resolveReadContext({ runtime, req: userReq, scope: '*' })
		expect(allowed.ok).toBe(true)
		if (allowed.ok) {
			expect(allowed.scope).toBeNull()
			expect(allowed.queryScope).toBeUndefined()
		}
		const denied = await resolveReadContext({ runtime, req: anonReq, scope: '*' })
		expect(denied.ok).toBe(false)
	})

	it('honors a custom platformRead for cross-scope reads', async () => {
		const runtime = runtimeWith({ platformRead: () => false })
		const ctx = await resolveReadContext({ runtime, req: userReq, scope: '*' })
		expect(ctx.ok).toBe(false)
	})

	it('gates a scoped read through a platform adapter that cannot filter by scope', async () => {
		const runtime = runtimeWith({ platformAdapterId: 'memory' })
		const denied = await resolveReadContext({ runtime, req: anonReq, scope: 't1' })
		expect(denied.ok).toBe(false)
		const allowed = await resolveReadContext({ runtime, req: userReq, scope: 't1' })
		expect(allowed.ok).toBe(true)
		if (allowed.ok) {
			expect(allowed.queryScope).toBeUndefined()
		}
	})

	it('lets a scope-filtering platform adapter serve scoped reads ungated', async () => {
		const runtime = runtimeWith({
			registry: createRegistry([scopedAdapter()]),
			platformAdapterId: 'memory',
		})
		const ctx = await resolveReadContext({ runtime, req: anonReq, scope: 't1' })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBe('t1')
		}
	})

	it('leaves scoped reads through non-platform adapters ungated', async () => {
		const runtime = runtimeWith({ platformAdapterId: 'other' })
		const ctx = await resolveReadContext({ runtime, req: anonReq, scope: 't1' })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBe('t1')
		}
	})

	it('leaves null-scope reads through the platform adapter ungated', async () => {
		const runtime = runtimeWith({ platformAdapterId: 'memory' })
		const ctx = await resolveReadContext({ runtime, req: anonReq })
		expect(ctx.ok).toBe(true)
		if (ctx.ok) {
			expect(ctx.queryScope).toBeUndefined()
		}
	})
})
