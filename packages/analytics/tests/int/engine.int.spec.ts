import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { kvCacheStore } from '../../src/surfacing/cacheStore'
import { createEngine } from '../../src/surfacing/engine'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics engine integration', { dbs: ['mongo'] }, (db) => {
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

	it('serves a query through the engine over the real payload.kv, caching the second read', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
		const spy = vi.spyOn(adapter, 'query')

		const engine = createEngine({
			store: kvCacheStore(booted.payload.kv),
			queue: { concurrency: 4 },
			ttl: { aggregate: 60, realtime: 5 },
		})
		const query: AnalyticsQuery = {
			path: '/pricing',
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
		}

		const first = await engine.read(adapter, query)
		const second = await engine.read(adapter, query)

		expect(first.totals?.pageviews).toBe(1)
		expect(second.totals?.pageviews).toBe(1)
		expect(spy).toHaveBeenCalledTimes(1)
	})
})
