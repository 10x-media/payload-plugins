import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { combineRegistries, createScopedRegistryResolver } from './resolver'

const stub = (id: string): AnalyticsAdapter => ({ ...memoryAdapter(), id })

const payload = {} as Payload

describe('combineRegistries', () => {
	it('returns the base registry when there are no runtime adapters', () => {
		const a = stub('a')
		const registry = combineRegistries({ adapters: [a] }, [])
		expect(registry.all()).toEqual([a])
	})

	it('appends new runtime adapters after the base', () => {
		const a = stub('a')
		const b = stub('b')
		const registry = combineRegistries({ adapters: [a] }, [b])
		expect(registry.all().map((x) => x.id)).toEqual(['a', 'b'])
		expect(registry.default()).toBe(a)
	})

	it('replaces a base adapter in place when ids collide, including the default', () => {
		const base = stub('plausible')
		const runtime = stub('plausible')
		const registry = combineRegistries({ adapters: [base, stub('x')] }, [runtime])
		expect(registry.get('plausible')).toBe(runtime)
		expect(registry.default()).toBe(runtime)
		expect(registry.all()).toHaveLength(2)
	})

	it('keeps an explicit default id pointing at the runtime instance after override', () => {
		const runtime = stub('b')
		const registry = combineRegistries({ adapters: [stub('a'), stub('b')], defaultId: 'b' }, [
			runtime,
		])
		expect(registry.default()).toBe(runtime)
	})
})

describe('createScopedRegistryResolver', () => {
	it('caches per scope within the TTL', async () => {
		const calls: Array<string | null> = []
		const { resolver } = createScopedRegistryResolver({
			base: { adapters: [stub('base')] },
			source: async ({ scope }) => {
				calls.push(scope)
				return [stub(`runtime-${scope}`)]
			},
			ttlMs: 60_000,
		})
		await resolver({ payload, scope: 't1' })
		await resolver({ payload, scope: 't1' })
		await resolver({ payload, scope: null })
		expect(calls).toEqual(['t1', null])
	})

	it('keeps scopes isolated', async () => {
		const { resolver } = createScopedRegistryResolver({
			base: { adapters: [stub('base')] },
			source: async ({ scope }) => (scope === 't1' ? [stub('only-t1')] : []),
			ttlMs: 60_000,
		})
		const t1 = await resolver({ payload, scope: 't1' })
		const t2 = await resolver({ payload, scope: 't2' })
		expect(t1.all().map((a) => a.id)).toEqual(['base', 'only-t1'])
		expect(t2.all().map((a) => a.id)).toEqual(['base'])
	})

	it('re-queries after invalidate', async () => {
		let calls = 0
		const { resolver, invalidate } = createScopedRegistryResolver({
			base: { adapters: [stub('base')] },
			source: async () => {
				calls++
				return []
			},
			ttlMs: 60_000,
		})
		await resolver({ payload, scope: 't1' })
		invalidate()
		await resolver({ payload, scope: 't1' })
		expect(calls).toBe(2)
	})

	it('re-queries after the TTL elapses', async () => {
		let calls = 0
		const { resolver } = createScopedRegistryResolver({
			base: { adapters: [stub('base')] },
			source: async () => {
				calls++
				return []
			},
			ttlMs: 0,
		})
		await resolver({ payload, scope: 't1' })
		await resolver({ payload, scope: 't1' })
		expect(calls).toBe(2)
	})
})
