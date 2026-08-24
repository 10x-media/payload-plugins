import type { PayloadRequest } from 'payload'
import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { kvCacheStore } from '../surfacing/cacheStore'
import { createEngine } from '../surfacing/engine'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForWidget } from './readForWidget'

const NOW = new Date('2026-06-01T00:00:00Z')

const reqWith = (adapters: AnalyticsAdapter[]): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((a) => a.id)),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload } as PayloadRequest
}

describe('readForWidget', () => {
	it('returns ok with totals from the default adapter', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/test', timestamp: new Date('2026-05-15T12:00:00Z') })
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBeGreaterThanOrEqual(1)
		expect(result.adapterId).toBe(adapter.id)
	})

	it('returns not-configured when the adapter is unconfigured', async () => {
		const adapter: AnalyticsAdapter = {
			id: 'unconfigured',
			label: 'Unconfigured',
			capabilities: memoryAdapter().capabilities,
			isConfigured: () => false,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return { rows: [], meta: { provider: 'unconfigured', fetchedAt: new Date().toISOString() } }
			},
		}
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('not-configured')
	})

	it('returns unavailable when the adapter lacks the metric', async () => {
		const baseCapabilities = memoryAdapter().capabilities
		const adapter: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: {
				...baseCapabilities,
				metrics: new Set<import('../core/contract').MetricKey>(['pageviews']),
			},
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return { rows: [], meta: { provider: 'limited', fetchedAt: new Date().toISOString() } }
			},
		}
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['scrollDepth'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	it('returns unavailable when the runtime is missing', async () => {
		const result = await readForWidget({
			req: { payload: {} as PayloadRequest['payload'] } as PayloadRequest,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	it('reads from the adapter named by adapterId', async () => {
		const stub = (provider: string, pageviews: number): AnalyticsAdapter => ({
			id: provider,
			label: provider,
			capabilities: memoryAdapter().capabilities,
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return { rows: [], totals: { pageviews }, meta: { provider, fetchedAt: NOW.toISOString() } }
			},
		})
		const result = await readForWidget({
			req: reqWith([stub('primary', 1), stub('secondary', 2)]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			adapterId: 'secondary',
			now: NOW,
		})
		expect(result.adapterId).toBe('secondary')
		expect(result.metrics.pageviews).toBe(2)
	})

	it('returns previous-window totals when the adapter supports comparison', async () => {
		const adapter = memoryAdapter()
		// Current window (last 7 days ending NOW) has two hits; the prior 7 days has one.
		adapter.record({ path: '/c', timestamp: new Date('2026-05-30T12:00:00Z') })
		adapter.record({ path: '/c', timestamp: new Date('2026-05-31T12:00:00Z') })
		adapter.record({ path: '/c', timestamp: new Date('2026-05-24T12:00:00Z') })
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.comparisonRange).toBeDefined()
		expect(result.previousMetrics?.pageviews).toBe(1)
	})

	it('omits comparison data when the adapter does not support it', async () => {
		const base = memoryAdapter()
		const adapter: AnalyticsAdapter = {
			id: 'no-compare',
			label: 'No compare',
			capabilities: { ...base.capabilities, comparison: false },
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return {
					rows: [],
					totals: { pageviews: 3 },
					meta: { provider: 'no-compare', fetchedAt: NOW.toISOString() },
				}
			},
		}
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousMetrics).toBeUndefined()
	})

	it('returns unavailable for an unknown adapterId', async () => {
		const result = await readForWidget({
			req: reqWith([memoryAdapter()]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			adapterId: 'does-not-exist',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
		expect(result.adapterId).toBe('does-not-exist')
	})

	it('applies a filter, narrowing totals to the matching events', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		adapter.record({ path: '/b', timestamp: new Date('2026-05-16T12:00:00Z') })
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(1)
	})

	it('returns unavailable when the adapter lacks the filter dimension', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		const result = await readForWidget({
			req: reqWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			// memoryAdapter's capabilities.filters only declares 'page'.
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('unavailable')
	})

	it('forwards filters into the engine query, producing a distinct cache key', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		const store = kvCacheStore(inMemoryKVAdapter().init({} as never))
		const engine = createEngine({
			store,
			queue: { concurrency: 4 },
			ttl: { aggregate: 60, realtime: 5 },
		})
		const payload = {} as PayloadRequest['payload']
		setRuntime(payload, {
			registry: createRegistry([adapter]),
			configAdapterIds: new Set([adapter.id]),
			bindings: {},
			engine,
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: false,
		})
		const req = { payload } as PayloadRequest
		const spy = vi.spyOn(adapter, 'query')
		await readForWidget({ req, metrics: ['pageviews'], timeframe: 'last30days', now: NOW })
		await readForWidget({
			req,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(spy).toHaveBeenCalledTimes(2)
	})
})
