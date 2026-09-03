import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ProviderHttpError } from '../../src/adapters/http/fetchJson'
import { analytics } from '../../src/index'
import { getRuntime } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'

// A 4xx (non-429) ProviderHttpError never retries (see retryPolicy.ts), so one failNext()
// call reliably fails the read. The default 500 status would retry twice and succeed on
// a later attempt, since failNext only fails the next single query() call.
const injectedFailure = () => new ProviderHttpError(400, 'memory', 'memory: injected failure')

describeForDb('analytics engine resilience', { dbs: ['mongo'] }, (db) => {
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [mem],
				cache: { ttl: { aggregate: 1 } },
				// Comparison reads would run a second, concurrent engine.read per readForWidget
				// call, racing against the single queued failNext() for which one consumes it.
				widgets: { comparison: false },
			}),
			db,
		})
		mem.record({ path: '/pricing', timestamp: new Date('2026-01-10') })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const req = () => ({ payload: booted.payload }) as unknown as PayloadRequest

	it('serves a stale cache entry flagged meta.stale when the refresh fails after the TTL expires', async () => {
		const first = await readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(first.status).toBe('ok')
		expect(first.metrics.pageviews).toBe(1)

		// aggregate TTL above is 1s; sleeping past it with a real timer (bounded, ~2s) is the
		// simplest way to expire the entry without reaching into the cache store's clock.
		await new Promise((resolve) => setTimeout(resolve, 2_000))

		mem.failNext(injectedFailure())
		const second = await readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(second.status).toBe('ok')
		expect(second.metrics.pageviews).toBe(1)

		// readForWidget's result shape does not expose meta.stale; assert it through the
		// runtime engine directly against the same query.
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		mem.failNext(injectedFailure())
		const direct = await runtime.engine.read(mem, {
			metrics: ['pageviews'],
			dateRange: first.dateRange,
			timezone: 'UTC',
		})
		expect(direct.meta.stale).toBe(true)
		expect(direct.totals?.pageviews).toBe(1)
	})

	it('reports unavailable when a cold cache key fails with no stale entry to fall back to', async () => {
		mem.failNext(injectedFailure())
		const result = await readForWidget({
			req: req(),
			metrics: ['visitors'],
			timeframe: 'last7days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(result.status).toBe('unavailable')
	})
})
