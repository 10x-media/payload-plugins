import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
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
	filters: new Set(),
	filterOperators: new Set(['eq']),
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
		configAdapterIds: new Set(adapters.map((a) => a.id)),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload } as PayloadRequest
}

describe('fillDailySeries', () => {
	it('zero-fills the requested daily window in order', () => {
		const points = fillDailySeries({
			rows: [{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { pageviews: 5 } }],
			dateRange: { start: new Date('2026-06-01T00:00:00.000Z'), end: NOW },
			metric: 'pageviews',
		})
		expect(points).toEqual([
			{ date: '2026-06-01T00:00:00.000Z', value: 0 },
			{ date: '2026-06-02T00:00:00.000Z', value: 5 },
			{ date: '2026-06-03T00:00:00.000Z', value: 0 },
		])
	})

	it('caps an unbounded range to the most recent 366 days', () => {
		const points = fillDailySeries({
			rows: [],
			dateRange: { start: new Date(0), end: NOW },
			metric: 'pageviews',
		})
		expect(points).toHaveLength(366)
		expect(points.at(-1)?.date).toBe('2026-06-03T00:00:00.000Z')
	})

	it('aligns the daily axis to a non-UTC reporting timezone', () => {
		const points = fillDailySeries({
			rows: [{ timestamp: '2026-06-16T22:00:00.000Z', metrics: { pageviews: 4 } }],
			dateRange: {
				start: new Date('2026-06-16T22:00:00.000Z'),
				end: new Date('2026-06-17T21:00:00.000Z'),
			},
			metric: 'pageviews',
			tz: 'Europe/Berlin',
		})
		// One Berlin day, its midnight is 22:00Z the previous UTC day.
		expect(points).toEqual([{ date: '2026-06-16T22:00:00.000Z', value: 4 }])
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

	it('returns previous-window comparison data when the adapter supports it', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonRange).toBeDefined()
		expect(result.previousTotal).toBe(12)
	})

	it('returns a comparison series aligned to the primary axis when compare is asked for', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			compare: true,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonPoints).toHaveLength(result.points.length)
		expect(result.previousTotal).toBe(12)
		// The adapter's rows fall outside the previous window, so every bucket zero-fills.
		expect(result.comparisonPoints?.every((p) => p.value === 0)).toBe(true)
	})

	it('reads the previous window at day granularity only when compare is asked for', async () => {
		const received: (Granularity | undefined)[] = []
		const adapter = seriesAdapter({
			capabilities: { ...baseCaps(), comparison: true },
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				received.push(q.granularity)
				return {
					rows: [],
					totals: { pageviews: 3 },
					meta: { provider: 'native', fetchedAt: NOW.toISOString() },
				}
			},
		})
		await readForWidgetSeries({
			req: reqWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			compare: true,
		})
		expect(received).toEqual(['day', 'day'])
	})

	it('omits the comparison series when compare is not asked for', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			compare: false,
		})
		expect(result.comparisonPoints).toBeUndefined()
		expect(result.previousTotal).toBe(12)
	})

	it('omits the comparison series and reads once when the adapter cannot compare', async () => {
		let reads = 0
		const adapter = seriesAdapter({
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				reads += 1
				return {
					rows: [],
					totals: { pageviews: 1 },
					meta: { provider: 'native', fetchedAt: NOW.toISOString() },
				}
			},
		})
		const result = await readForWidgetSeries({
			req: reqWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			compare: true,
		})
		expect(result.comparisonPoints).toBeUndefined()
		expect(result.comparisonRange).toBeUndefined()
		expect(reads).toBe(1)
	})

	it('omits comparison data when the adapter does not support it', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([seriesAdapter()]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousTotal).toBeUndefined()
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

	it('forwards filters into the engine query', async () => {
		let received: AnalyticsQuery | undefined
		const adapter = seriesAdapter({
			capabilities: { ...baseCaps(), filters: new Set(['page']) },
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				received = q
				return {
					rows: [],
					totals: { pageviews: 12 },
					meta: { provider: 'native', fetchedAt: NOW.toISOString() },
				}
			},
		})
		const result = await readForWidgetSeries({
			req: reqWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('ok')
		expect(received?.filters).toEqual([{ dimension: 'page', operator: 'eq', value: '/a' }])
	})

	it('answers filter-unsupported, without querying, when the adapter lacks the dimension', async () => {
		const adapter = seriesAdapter({ capabilities: baseCaps() })
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidgetSeries({
			req: reqWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			// baseCaps declares no filters at all.
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	it('answers filter-unsupported when the operator is the part the adapter lacks', async () => {
		const adapter = seriesAdapter({
			capabilities: { ...baseCaps(), filters: new Set(['page']) },
		})
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidgetSeries({
			req: reqWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			// baseCaps declares 'eq' alone.
			filters: [{ dimension: 'page', operator: 'matches', value: '^/a' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	// The sentinel is what keeps a failed resolver off the healthy cache key, so every
	// helper has to hand it to the adapter rather than flattening it to an empty hint.
	it('passes the failed-resolver sentinel through to the adapter', async () => {
		const seen: AnalyticsQuery[] = []
		const adapter = seriesAdapter({
			capabilities: { ...baseCaps(), metrics: new Set(['conversions']) },
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				seen.push(q)
				return { rows: [], meta: { provider: 'native', fetchedAt: NOW.toISOString() } }
			},
		})
		const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
		setRuntime(payload, {
			registry: createRegistry([adapter]),
			configAdapterIds: new Set([adapter.id]),
			bindings: {},
			engine: { read: async (a, query) => a.query(query, {}) },
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: false,
			resolveGoals: () => Promise.reject(new Error('boom')),
		})
		const result = await readForWidgetSeries({
			req: { payload } as PayloadRequest,
			metric: 'conversions',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})

	it('still answers unavailable when day granularity is what the adapter lacks', async () => {
		const result = await readForWidgetSeries({
			req: reqWith([
				seriesAdapter({
					capabilities: { ...baseCaps(), filters: new Set(['page']), minGranularity: 'month' },
				}),
			]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('unavailable')
	})
})
