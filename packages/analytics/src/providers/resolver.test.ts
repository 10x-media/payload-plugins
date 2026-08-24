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

	it('appends runtime adapters after the base', () => {
		const base = stub('memory')
		const instance = stub('posthog:doc1')
		const registry = combineRegistries({ adapters: [base] }, [instance])
		expect(registry.all()).toEqual([base, instance])
		expect(registry.get('memory')).toBe(base)
		expect(registry.get('posthog:doc1')).toBe(instance)
	})

	it('skips an extra whose id collides with a base adapter (base wins)', () => {
		const base = stub('posthog')
		const runtime = stub('posthog')
		const registry = combineRegistries({ adapters: [base] }, [runtime])
		expect(registry.get('posthog')).toBe(base)
		expect(registry.all()).toEqual([base])
	})

	it('two instance adapters of one provider type both join the registry', () => {
		const base = stub('memory')
		const a = stub('posthog:a')
		const b = stub('posthog:b')
		const registry = combineRegistries({ adapters: [base] }, [a, b])
		expect(registry.get('posthog:a')).toBe(a)
		expect(registry.get('posthog:b')).toBe(b)
		expect(registry.all()).toEqual([base, a, b])
	})

	it('the default stays the config default regardless of extras', () => {
		const registry = combineRegistries({ adapters: [stub('a'), stub('b')], defaultId: 'b' }, [
			stub('posthog:doc1'),
		])
		expect(registry.default().id).toBe('b')
	})

	it('with no explicit default the first config adapter stays default', () => {
		const registry = combineRegistries({ adapters: [stub('a'), stub('b')] }, [stub('posthog:doc1')])
		expect(registry.default().id).toBe('a')
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
