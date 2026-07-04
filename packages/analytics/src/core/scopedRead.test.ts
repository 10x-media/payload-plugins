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
