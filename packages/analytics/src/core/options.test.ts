import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveOptions } from './options'

describe('resolveOptions', () => {
	it('fills cache TTL defaults', () => {
		const r = resolveOptions({ adapters: [memoryAdapter()] })
		expect(r.cache.ttl.aggregate).toBeGreaterThan(0)
		expect(r.cache.ttl.realtime).toBeGreaterThan(0)
	})
	it('throws when no adapters are supplied', () => {
		expect(() => resolveOptions({ adapters: [] })).toThrow(/at least one adapter/i)
	})
})

describe('resolveOptions bindings', () => {
	const adapter = memoryAdapter()

	it('defaults bindings to an empty object', () => {
		expect(resolveOptions({ adapters: [adapter] }).bindings).toEqual({})
	})

	it('passes through a resolver binding', () => {
		const path = (doc: Record<string, unknown>) => `/${doc.slug as string}`
		const resolved = resolveOptions({ adapters: [adapter], collections: { pages: { path } } })
		expect(resolved.bindings.pages?.path).toBe(path)
	})

	it('accepts a pathField-only binding', () => {
		const resolved = resolveOptions({
			adapters: [adapter],
			collections: { posts: { pathField: 'permalink' } },
		})
		expect(resolved.bindings.posts?.pathField).toBe('permalink')
	})

	it('throws when a binding has neither path nor pathField', () => {
		expect(() => resolveOptions({ adapters: [adapter], collections: { pages: {} } })).toThrow(
			/pages.*path.*pathField/i
		)
	})
})
