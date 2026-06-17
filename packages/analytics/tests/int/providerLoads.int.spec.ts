import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { plausible } from '../../src/adapters/plausible/plausible'
import { umami } from '../../src/adapters/umami/umami'
import { analytics } from '../../src/index'
import { kvCacheStore } from '../../src/surfacing/cacheStore'
import { createEngine } from '../../src/surfacing/engine'

describeForDb('analytics provider adapters load', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [
					plausible({ siteId: 'example.com', apiKey: 'k' }),
					umami({ websiteId: 'w', apiKey: 'k' }),
				],
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('boots with both provider adapters registered', () => {
		expect(booted.payload).toBeDefined()
	})

	it('serves an unconfigured adapter as a no-network empty result through the engine', async () => {
		const engine = createEngine({
			store: kvCacheStore(booted.payload.kv),
			queue: { concurrency: 2 },
			ttl: { aggregate: 60, realtime: 5 },
		})
		const result = await engine.read(plausible({ siteId: '', apiKey: '' }), {
			path: '/x',
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
		})
		expect(result.rows).toEqual([])
		expect(result.totals).toBeUndefined()
	})
})
