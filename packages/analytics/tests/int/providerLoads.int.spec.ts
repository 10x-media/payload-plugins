import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ga4 } from '../../src/adapters/ga4/ga4'
import { plausible } from '../../src/adapters/plausible/plausible'
import { posthog } from '../../src/adapters/posthog/posthog'
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
					ga4({
						propertyId: '123456789',
						credentials: { client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'pk' },
					}),
					posthog({ projectId: '123', apiKey: 'phx_k' }),
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
			timeoutMs: 15_000,
		})
		const result = await engine.read(plausible({ siteId: '', apiKey: '' }), {
			path: '/x',
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
		})
		expect(result.rows).toEqual([])
		expect(result.totals).toBeUndefined()
	})

	it('serves an unconfigured PostHog adapter as a no-network empty result', async () => {
		const engine = createEngine({
			store: kvCacheStore(booted.payload.kv),
			queue: { concurrency: 2 },
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 15_000,
		})
		const result = await engine.read(posthog({ projectId: '', apiKey: '' }), {
			path: '/x',
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
		})
		expect(result.rows).toEqual([])
		expect(result.totals).toBeUndefined()
	})
})
