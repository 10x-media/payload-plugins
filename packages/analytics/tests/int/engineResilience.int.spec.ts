import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT_JOBS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { getRuntime } from '../../src/plugin/runtime'
import { syncTask } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { readForWidgetBreakdown } from '../../src/widgets/readForWidgetBreakdown'
import { readForWidgetSeries } from '../../src/widgets/readForWidgetSeries'
import { advancePayloadClock, resetPayloadClock } from './payloadClock'
import { readerRequest } from './readerRequest'

// An outage the engine does not retry: a source that timed out is not asked again at once, so one
// failNext fails the whole read. A 5xx would be retried, and a 4xx is not an outage at all.
const injectedFailure = () =>
	Object.assign(new Error('memory: injected timeout'), { name: 'TimeoutError' })

describeForDb('analytics engine resilience', {}, (db) => {
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
		resetPayloadClock()
		await booted.stop()
	})

	const req = () => readerRequest(booted.payload)

	it('serves a stale cache entry flagged meta.stale when the refresh fails after the TTL expires', async () => {
		const first = await readForWidget({
			req: req(),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(first.status).toBe('ok')
		expect(first.metrics.pageviews).toBe(1)

		// Past the aggregate TTL above (1s) on the clock the cache expires its entries by.
		await advancePayloadClock(booted.payload, 2_000)

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
		// The refreshes run behind the answers; let them finish before the next read injects a failure.
		await runtime.engine.idle?.()
	})

	it('reports busy, not unavailable, when a cold cache key fails with no stale entry to fall back to', async () => {
		mem.failNext(injectedFailure())
		const result = await readForWidget({
			req: req(),
			metrics: ['visitors'],
			timeframe: 'last7days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(result.status).toBe('busy')
	})

	it('reports busy for a series read on a cold cache key with no stale entry', async () => {
		mem.failNext(injectedFailure())
		const result = await readForWidgetSeries({
			req: req(),
			metric: 'sessions',
			timeframe: 'last7days',
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(result.status).toBe('busy')
	})

	it('reports busy for a breakdown read on a cold cache key with no stale entry', async () => {
		mem.failNext(injectedFailure())
		const result = await readForWidgetBreakdown({
			req: req(),
			metric: 'bounceRate',
			dimension: 'device',
			timeframe: 'last30days',
			limit: 5,
			now: new Date('2026-01-31T00:00:00.000Z'),
		})
		expect(result.status).toBe('busy')
	})
})

describeForDb('analytics sync tier resilience', {}, (db) => {
	const mem = memoryAdapter()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [mem], sync: true, cache: { ttl: { aggregate: 1 } } }),
			db,
		})
		mem.record({ path: '/pricing', timestamp: new Date() })
	})

	afterAll(async () => {
		resetPayloadClock()
		await booted.stop()
	})

	const req = () => readerRequest(booted.payload)

	const runSync = async (): Promise<{ synced: number; failed: number }> => {
		const task = syncTask({
			schedule: DEFAULT_JOBS.sync,
			lookbackDays: 3,
			collectionSlug: 'analytics-daily',
		})
		const handler = task.handler
		if (typeof handler !== 'function') {
			throw new Error('sync handler must be a function')
		}
		const result = await handler({ req: req() } as unknown as Parameters<typeof handler>[0])
		return (result as { output: { synced: number; failed: number } }).output
	}

	it('skips upserting a stale-served read: failed counts it and syncedAt does not advance', async () => {
		const first = await runSync()
		expect(first.failed).toBe(0)
		expect(first.synced).toBeGreaterThan(0)

		const before = await booted.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'memory' } },
			limit: 100,
			overrideAccess: true,
		})
		const beforeSyncedAt = new Map(
			(before.docs as unknown as Array<{ id: string | number; syncedAt: string }>).map((d) => [
				d.id,
				d.syncedAt,
			])
		)
		expect(beforeSyncedAt.size).toBeGreaterThan(0)

		await advancePayloadClock(booted.payload, 2_000)

		mem.failNext(injectedFailure())
		const second = await runSync()
		expect(second.failed).toBeGreaterThanOrEqual(1)

		const after = await booted.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'memory' } },
			limit: 100,
			overrideAccess: true,
		})
		for (const doc of after.docs as unknown as Array<{ id: string | number; syncedAt: string }>) {
			expect(doc.syncedAt).toBe(beforeSyncedAt.get(doc.id))
		}
	})
})
