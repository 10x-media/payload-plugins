import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentScopeField } from '../binding/types'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveDocumentScope, scopeFieldFor } from './documentScopes'
import type { AnalyticsRuntime } from './runtime'

const runtimeWith = (
	scopeField: DocumentScopeField,
	overrides: Partial<AnalyticsRuntime> = {}
): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(['memory']),
	bindings: { pages: { pathField: 'slug', scopeField } },
	readAccess: () => true,
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	scoped: true,
	resolveScope: async () => 'alpha',
	member: () => true,
	...overrides,
})

const reqFor = (): PayloadRequest =>
	({ user: { id: 1 }, payload: { logger: { warn: vi.fn() } } }) as unknown as PayloadRequest

describe('scopeFieldFor', () => {
	it("reads the collection binding's scope field", () => {
		expect(scopeFieldFor(runtimeWith('site'), 'pages')).toBe('site')
		expect(scopeFieldFor(runtimeWith(false), 'pages')).toBe(false)
	})

	it("reads the request's own scope for a collection that is not bound", () => {
		expect(scopeFieldFor(runtimeWith('tenant'), 'posts')).toBe(false)
	})
})

describe('resolveDocumentScope', () => {
	const resolve = (runtime: AnalyticsRuntime, data: Record<string, unknown>) =>
		resolveDocumentScope({ runtime, req: reqFor(), collection: 'pages', data })

	it("answers the document's own scope when it is the reader's own", async () => {
		const answer = await resolve(runtimeWith('tenant'), { id: 'p1', tenant: 'alpha' })
		expect(answer).toMatchObject({ ok: true, scope: 'alpha' })
		expect(answer.ok && answer.scope !== null && answer.gated.value).toBe('alpha')
	})

	it("refuses the reader's own scope when the user does not belong to it", async () => {
		const runtime = runtimeWith('tenant', {
			member: () => false,
			crossScope: allCrossScope(() => false),
		})
		expect(await resolve(runtime, { id: 'p1', tenant: 'alpha' })).toEqual({ ok: false })
	})

	it('refuses another scope for a reader `named` denies', async () => {
		const runtime = runtimeWith('tenant', { crossScope: allCrossScope(() => false) })
		expect(await resolve(runtime, { id: 'p1', tenant: 'beta' })).toEqual({ ok: false })
	})

	it('answers it for platform staff', async () => {
		const runtime = runtimeWith('tenant', { crossScope: allCrossScope(() => true) })
		expect(await resolve(runtime, { id: 'p1', tenant: 'beta' })).toMatchObject({
			ok: true,
			scope: 'beta',
		})
	})

	it('answers null when the document names no scope of its own', async () => {
		const runtime = runtimeWith('tenant', { crossScope: allCrossScope(() => false) })
		expect(await resolve(runtime, { id: 'p1' })).toEqual({ ok: true, scope: null })
	})

	it('reads the field the binding names and no other', async () => {
		const runtime = runtimeWith('site', { crossScope: allCrossScope(() => false) })
		expect(await resolve(runtime, { id: 'p1', tenant: 'alpha', site: 'beta' })).toEqual({
			ok: false,
		})
	})

	it('answers null for a binding whose scope field is false, whatever the document holds', async () => {
		const runtime = runtimeWith(false, { crossScope: allCrossScope(() => false) })
		expect(await resolve(runtime, { id: 'p1', tenant: 'beta' })).toEqual({ ok: true, scope: null })
	})
})
