import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { CACHE_SLUG } from '../../src/surfacing/cacheCollection'
import { collectionCacheStore } from '../../src/surfacing/collectionCacheStore'
import { createEngine } from '../../src/surfacing/engine'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics engine integration', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [memoryAdapter()] }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('serves a query through the engine over the analytics-cache collection, caching the second read', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
		const spy = vi.spyOn(adapter, 'query')
		const store = collectionCacheStore(booted.payload, { slug: CACHE_SLUG })
		const query: AnalyticsQuery = {
			path: '/pricing',
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
		}
		const engineOn = () =>
			createEngine({
				store,
				ttl: { aggregate: 60, realtime: 5 },
				timeoutMs: 15_000,
			})

		const writer = engineOn()
		const first = await writer.read(adapter, query)
		// The answer is written in the background; a second engine has a memo of its own, so its
		// read comes from the collection once the write landed.
		await writer.idle()
		const second = await engineOn().read(adapter, query)

		expect(first.totals?.pageviews).toBe(1)
		expect(second).toEqual(first)
		expect(spy).toHaveBeenCalledTimes(1)
	})
})
