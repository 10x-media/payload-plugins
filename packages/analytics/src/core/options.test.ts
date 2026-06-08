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
