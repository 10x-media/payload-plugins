import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import type { AnalyticsRuntime } from './runtime'
import { setRuntime } from './runtime'
import { makeSourcesHandler } from './sourcesEndpoint'

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(['memory']),
	bindings: {},
	readAccess: () => true,
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	...overrides,
})

type SourcesBody = { defaultId: string | null; sources: unknown[] }

const reqWithRuntime = (runtime: AnalyticsRuntime): PayloadRequest => {
	const payload = {} as unknown as Payload
	setRuntime(payload, runtime)
	return { user: { id: 1 }, payload } as unknown as PayloadRequest
}

describe('makeSourcesHandler resolution failure', () => {
	it('falls back to the static config registry on an unscoped install', async () => {
		const handler = makeSourcesHandler()
		const req = reqWithRuntime(
			runtimeWith({
				scoped: false,
				resolveScope: async () => {
					throw new Error('boom')
				},
			})
		)
		const res = await handler(req)
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBe('memory')
		expect(body.sources.length).toBeGreaterThan(0)
	})

	it('answers empty on a scoped install, since a failed resolution is indistinguishable from a forged one', async () => {
		const handler = makeSourcesHandler()
		const req = reqWithRuntime(
			runtimeWith({
				scoped: true,
				resolveScope: async () => {
					throw new Error('boom')
				},
			})
		)
		const res = await handler(req)
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBeNull()
		expect(body.sources).toEqual([])
	})
})

describe('makeSourcesHandler for one document', () => {
	const base = memoryAdapter()
	const scopedSource = { ...base, capabilities: { ...base.capabilities, scopedQueries: true } }

	const reqFor = (named: boolean): PayloadRequest => {
		const payload = {
			findByID: async () => ({ id: 'p1', slug: '/home', tenant: 'beta' }),
		} as unknown as Payload
		setRuntime(
			payload,
			runtimeWith({
				registry: createRegistry([scopedSource]),
				bindings: { pages: { pathField: 'slug', scopeField: 'tenant' } },
				scoped: true,
				resolveScope: async () => 'alpha',
				crossScope: allCrossScope(() => named),
			})
		)
		return {
			user: { id: 1 },
			payload,
			url: '/api/_x/sources?collection=pages&id=p1',
		} as unknown as PayloadRequest
	}

	// The switcher lists the document's scope's sources, so listing one is reading across too.
	it('refuses a document belonging to a tenant the reader may not name', async () => {
		const res = await makeSourcesHandler()(reqFor(false))

		expect(res.status).toBe(400)
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('untrusted_scope')
	})

	it('lists that scope for platform staff', async () => {
		const res = await makeSourcesHandler()(reqFor(true))

		expect(res.status).toBe(200)
		expect(((await res.json()) as SourcesBody).sources.length).toBeGreaterThan(0)
	})
})
