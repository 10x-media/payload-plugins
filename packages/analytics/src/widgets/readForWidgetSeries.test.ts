import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	Granularity,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { fillDailySeries, readForWidgetSeries } from './readForWidgetSeries'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const baseCaps = (minGranularity: Granularity = 'day'): AnalyticsCapabilities => ({
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity,
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
})

const seriesAdapter = (over: Partial<AnalyticsAdapter> = {}): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: baseCaps(),
	isConfigured: () => true,
	async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		return {
			rows: [
				{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { pageviews: 5 } },
				{ timestamp: '2026-06-03T00:00:00.000Z', metrics: { pageviews: 7 } },
			],
			totals: { pageviews: 12 },
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
	})
	return { payload } as PayloadRequest
}

describe('fillDailySeries', () => {
	it('zero-fills the requested daily window in order', () => {
		const points = fillDailySeries(
			[{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { pageviews: 5 } }],
			{ start: new Date('2026-06-01T00:00:00.000Z'), end: NOW },
			'pageviews'
		)
		expect(points).toEqual([
			{ date: '2026-06-01T00:00:00.000Z', value: 0 },
			{ date: '2026-06-02T00:00:00.000Z', value: 5 },
			{ date: '2026-06-03T00:00:00.000Z', value: 0 },
		])
	})

	it('caps an unbounded range to the most recent 366 days', () => {
		const points = fillDailySeries([], { start: new Date(0), end: NOW }, 'pageviews')
		expect(points).toHaveLength(366)
		expect(points.at(-1)?.date).toBe('2026-06-03T00:00:00.000Z')
	})
})

describe('readForWidgetSeries', () => {
	it('returns ok with zero-filled points and the headline total', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter()]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.total).toBe(12)
		expect(result.points).toHaveLength(7)
		expect(result.points.at(-1)).toEqual({ date: '2026-06-03T00:00:00.000Z', value: 7 })
		expect(result.points.at(-2)).toEqual({ date: '2026-06-02T00:00:00.000Z', value: 5 })
	})

	it('returns unavailable when the adapter cannot bucket by day', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter({ capabilities: baseCaps('month') })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	it('returns not-configured when the adapter is unconfigured', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter({ isConfigured: () => false })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('not-configured')
	})

	it('returns unavailable when the runtime is missing', async () => {
		const result = await readForWidgetSeries({
			req: { payload: {} as PayloadRequest['payload'] } as PayloadRequest,
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})
})
