import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { isCaptureSlot, resolveSlotAdapter } from './slots'

const adapter = (id: string): AnalyticsAdapter =>
	({
		id,
		label: id,
		capabilities: { metrics: [], dimensions: [] },
		isConfigured: () => true,
		query: async () => ({ rows: [] }),
	}) as unknown as AnalyticsAdapter

/** An adapter declaring capture, which is what fills a slot. */
const capturing = (id: string): AnalyticsAdapter =>
	({ ...adapter(id), capture: { client: { kind: 'plausible' } } }) as unknown as AnalyticsAdapter

const warn = vi.fn()

const reqWith = (): PayloadRequest =>
	({ payload: { logger: { warn } } }) as unknown as PayloadRequest

const runtimeWith = (partial: Partial<AnalyticsRuntime>): AnalyticsRuntime => {
	const adapters = partial.registry ? partial.registry.all() : [adapter('native')]
	return {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((a) => a.id)),
		bindings: {},
		engine: {} as AnalyticsRuntime['engine'],
		ttl: {},
		comparison: true,
		...partial,
	}
}

describe('isCaptureSlot', () => {
	it('accepts only the two declared slots', () => {
		expect(isCaptureSlot('global')).toBe(true)
		expect(isCaptureSlot('tenant')).toBe(true)
		expect(isCaptureSlot('admin')).toBe(false)
		expect(isCaptureSlot('')).toBe(false)
		expect(isCaptureSlot('../global')).toBe(false)
	})
})

describe('resolveSlotAdapter - global', () => {
	it('resolves the single config adapter by default', async () => {
		const runtime = runtimeWith({})
		expect((await resolveSlotAdapter(runtime, reqWith(), 'global'))?.id).toBe('native')
	})

	it('resolves the designated platform adapter when several are configured', async () => {
		const runtime = runtimeWith({
			registry: createRegistry([adapter('native'), adapter('posthog')]),
			platformAdapterId: 'posthog',
		})
		expect((await resolveSlotAdapter(runtime, reqWith(), 'global'))?.id).toBe('posthog')
	})

	it('resolves nothing when several adapters are configured and none is designated', async () => {
		const runtime = runtimeWith({ registry: createRegistry([adapter('native'), adapter('ph')]) })
		expect(await resolveSlotAdapter(runtime, reqWith(), 'global')).toBeNull()
	})

	it('lets a capture.slots override win over the platform adapter', async () => {
		const runtime = runtimeWith({
			registry: createRegistry([adapter('native'), adapter('posthog')]),
			platformAdapterId: 'posthog',
			captureSlots: { global: 'native' },
		})
		expect((await resolveSlotAdapter(runtime, reqWith(), 'global'))?.id).toBe('native')
	})

	it('resolves nothing when the override names an unknown adapter', async () => {
		const runtime = runtimeWith({ captureSlots: { global: 'nope' } })
		expect(await resolveSlotAdapter(runtime, reqWith(), 'global')).toBeNull()
	})

	it('resolves nothing for a slot disabled with false, ahead of every default', async () => {
		const runtime = runtimeWith({ platformAdapterId: 'native', captureSlots: { global: false } })
		expect(await resolveSlotAdapter(runtime, reqWith(), 'global')).toBeNull()
	})

	it('never consults the per-scope registry for the platform slot', async () => {
		const resolveRegistry = vi.fn()
		const runtime = runtimeWith({
			resolveRegistry: resolveRegistry as unknown as AnalyticsRuntime['resolveRegistry'],
		})
		await resolveSlotAdapter(runtime, reqWith(), 'global')
		expect(resolveRegistry).not.toHaveBeenCalled()
	})
})

describe('resolveSlotAdapter - tenant', () => {
	it('resolves nothing on an install with no scope', async () => {
		expect(await resolveSlotAdapter(runtimeWith({}), reqWith(), 'tenant')).toBeNull()
	})

	it("resolves the scope registry's default when a scope resolves", async () => {
		const scoped = createRegistry([capturing('plausible:1')])
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async () => ({ registry: scoped, grants: new Map() }),
		})
		expect((await resolveSlotAdapter(runtime, reqWith(), 'tenant'))?.id).toBe('plausible:1')
	})

	// A default that cannot capture would leave the slot empty, and the config would drop it.
	it('passes over a default source that cannot capture for the first one that can', async () => {
		const scoped = createRegistry([adapter('ga4:reads'), capturing('plausible:1')])
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async () => ({ registry: scoped, grants: new Map() }),
		})
		expect(scoped.default().id).toBe('ga4:reads')
		expect((await resolveSlotAdapter(runtime, reqWith(), 'tenant'))?.id).toBe('plausible:1')
	})

	it('resolves nothing when no source of the scope can capture', async () => {
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async () => ({
				registry: createRegistry([adapter('ga4:reads')]),
				grants: new Map(),
			}),
		})
		expect(await resolveSlotAdapter(runtime, reqWith(), 'tenant')).toBeNull()
	})

	it('passes the resolved scope to the registry resolver', async () => {
		const seen: Array<string | null> = []
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async ({ scope }) => {
				seen.push(scope)
				return { registry: createRegistry([adapter('plausible:1')]), grants: new Map() }
			},
		})
		await resolveSlotAdapter(runtime, reqWith(), 'tenant')
		expect(seen).toEqual(['tenant-a'])
	})

	it('resolves a capture.slots override out of the per-scope registry', async () => {
		const scoped = createRegistry([adapter('native'), adapter('plausible:1')])
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async () => ({ registry: scoped, grants: new Map() }),
			captureSlots: { tenant: 'plausible:1' },
		})
		expect((await resolveSlotAdapter(runtime, reqWith(), 'tenant'))?.id).toBe('plausible:1')
	})

	it('resolves nothing for a tenant slot disabled with false, without resolving a scope', async () => {
		const resolveScope = vi.fn(async () => 'tenant-a')
		const runtime = runtimeWith({
			scoped: true,
			resolveScope,
			resolveRegistry: async () => ({
				registry: createRegistry([adapter('native')]),
				grants: new Map(),
			}),
			captureSlots: { tenant: false },
		})
		expect(await resolveSlotAdapter(runtime, reqWith(), 'tenant')).toBeNull()
		expect(resolveScope).not.toHaveBeenCalled()
	})

	it('resolves nothing when the scope resolver throws', async () => {
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => {
				throw new Error('boom')
			},
		})
		expect(await resolveSlotAdapter(runtime, reqWith(), 'tenant')).toBeNull()
	})

	it('resolves nothing when the per-scope registry lookup throws', async () => {
		const runtime = runtimeWith({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			resolveRegistry: async () => {
				throw new Error('boom')
			},
		})
		expect(await resolveSlotAdapter(runtime, reqWith(), 'tenant')).toBeNull()
	})
})
