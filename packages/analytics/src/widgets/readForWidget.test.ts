import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForWidget } from './readForWidget'

const NOW = new Date('2026-06-01T00:00:00Z')

const reqWith = (adapters: AnalyticsAdapter[]): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
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
})
