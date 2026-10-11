import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { resolveSlotAdapter } from './slots'

const adapter = (id: string, capture = true): AnalyticsAdapter =>
	({
		id,
		label: id,
		capabilities: { metrics: [], dimensions: [] },
		isConfigured: () => true,
		query: async () => ({ rows: [] }),
		...(capture ? { capture: { proxy: { routes: [] }, snippet: () => ({ scripts: [] }) } } : {}),
	}) as unknown as AnalyticsAdapter

const req = (): PayloadRequest =>
	({ payload: { logger: { warn: () => {} } } }) as unknown as PayloadRequest

const registry = createRegistry([adapter('native'), adapter('plausible:1')])

const runtimeWith = (grants: Map<string, string>, collection: boolean): AnalyticsRuntime =>
	({
		registry,
		configAdapterIds: new Set(['native']),
		bindings: {},
		engine: {} as AnalyticsRuntime['engine'],
		ttl: {},
		comparison: true,
		scoped: true,
		resolveScope: async () => 'alpha',
		resolveRegistry: async () => ({ registry, grants }),
		...(collection
			? { providersCollection: { slug: 'analytics-providers', scopeField: 'tenant' } }
			: {}),
	}) as AnalyticsRuntime

describe('tenant capture slot', () => {
	// A tenant captures native only while it says so: the `native` document is the switch.
	it("fills from the scope's own provider documents", async () => {
		const granted = new Map([['native', 'doc1']])
		const slot = await resolveSlotAdapter(runtimeWith(granted, true), req(), 'tenant')
		expect(slot?.id).toBe('native')
	})

	it('stays empty for a scope whose documents grant nothing', async () => {
		const slot = await resolveSlotAdapter(runtimeWith(new Map(), true), req(), 'tenant')
		expect(slot).toBeNull()
	})

	it('falls to a granted source that can capture when the default is not granted', async () => {
		const granted = new Map([['plausible:1', 'doc2']])
		const slot = await resolveSlotAdapter(runtimeWith(granted, true), req(), 'tenant')
		expect(slot?.id).toBe('plausible:1')
	})

	// Without a providers collection nothing grants anything, so the registry default stands.
	it('keeps the registry default when the install runs no providers collection', async () => {
		const slot = await resolveSlotAdapter(runtimeWith(new Map(), false), req(), 'tenant')
		expect(slot?.id).toBe('native')
	})
})
