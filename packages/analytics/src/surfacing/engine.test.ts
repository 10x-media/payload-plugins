import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { kvCacheStore } from './cacheStore'
import { createEngine } from './engine'

const q: AnalyticsQuery = {
	path: '/pricing',
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
}

const setup = () => {
	const adapter = memoryAdapter()
	adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
	const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
	const engine = createEngine({
		store,
		queue: { concurrency: 4 },
		ttl: { aggregate: 60, realtime: 5 },
	})
	return { adapter, engine, store }
}

describe('createEngine', () => {
	it('returns adapter data on cold miss and caches it', async () => {
		const { adapter, engine } = setup()
		const spy = vi.spyOn(adapter, 'query')
		const a = await engine.read(adapter, q)
		const b = await engine.read(adapter, q)
		expect(a.totals?.pageviews).toBe(1)
		expect(b.totals?.pageviews).toBe(1)
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('returns an unconfigured empty result without calling the adapter', async () => {
		const { engine } = setup()
		const unconfigured = { ...memoryAdapter(), isConfigured: () => false }
		const spy = vi.spyOn(unconfigured, 'query')
		const result = await engine.read(unconfigured, q)
		expect(result.rows).toEqual([])
		expect(result.meta.provider).toBe('memory')
		expect(spy).not.toHaveBeenCalled()
	})
})
