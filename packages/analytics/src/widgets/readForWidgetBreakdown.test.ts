import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const caps = (): AnalyticsCapabilities => ({
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['source']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
})

const breakdownAdapter = (over: Partial<AnalyticsAdapter> = {}): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: caps(),
	isConfigured: () => true,
	async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		return {
			rows: [
				{ dimensions: { source: 'google.com' }, metrics: { pageviews: 9 } },
				{ dimensions: { source: 'Direct' }, metrics: { pageviews: 4 } },
			],
			meta: { provider: 'native', fetchedAt: NOW.toISOString() },
		}
	},
	...over,
})

const reqWith = (adapters: AnalyticsAdapter[]): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload } as PayloadRequest
}

describe('readForWidgetBreakdown', () => {
	it('returns ok with label/value rows from the adapter dimension', async () => {
		const result = await readForWidgetBreakdown({
			req: reqWith([breakdownAdapter()]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.rows).toEqual([
			{ label: 'google.com', value: 9 },
			{ label: 'Direct', value: 4 },
		])
	})

	it('returns unavailable when the adapter lacks the dimension', async () => {
		const limited = breakdownAdapter({ capabilities: { ...caps(), dimensions: new Set() } })
		const result = await readForWidgetBreakdown({
			req: reqWith([limited]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	it('returns not-configured when the adapter is unconfigured', async () => {
		const result = await readForWidgetBreakdown({
			req: reqWith([breakdownAdapter({ isConfigured: () => false })]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(result.status).toBe('not-configured')
	})

	it('returns unavailable when the runtime is missing', async () => {
		const result = await readForWidgetBreakdown({
			req: { payload: {} as PayloadRequest['payload'] } as PayloadRequest,
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})
})
