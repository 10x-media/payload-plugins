import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import type { Goal } from '../goals/types'
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
	filters: new Set(),
	filterOperators: new Set(['eq']),
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
				{ dimensions: { source: 'search' }, metrics: { pageviews: 9 } },
				{ dimensions: { source: 'direct' }, metrics: { pageviews: 4 } },
			],
			meta: { provider: 'native', fetchedAt: NOW.toISOString() },
		}
	},
	...over,
})

const reqWith = (adapters: AnalyticsAdapter[], goals: Goal[] = []): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((a) => a.id)),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		goals,
	})
	return { payload } as PayloadRequest
}

const goalCaps = (): AnalyticsCapabilities => ({
	...caps(),
	metrics: new Set(['pageviews', 'conversions']),
	dimensions: new Set(['source', 'goal']),
})

/** Records the query it was read with and answers one goal row. */
const recordingAdapter = (
	seen: AnalyticsQuery[],
	capabilities: AnalyticsCapabilities
): AnalyticsAdapter =>
	breakdownAdapter({
		capabilities,
		async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
			seen.push(q)
			return {
				rows: [{ dimensions: { goal: 'signup' }, metrics: { conversions: 3 } }],
				meta: { provider: 'native', fetchedAt: NOW.toISOString() },
			}
		},
	})

const goal = (slug: string): Goal => ({ slug, name: slug, match: { kind: 'goal' } })

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
			{ label: 'search', value: 9 },
			{ label: 'direct', value: 4 },
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

	it('forwards filters into the engine query', async () => {
		let received: AnalyticsQuery | undefined
		const adapter = breakdownAdapter({
			capabilities: { ...caps(), filters: new Set(['country']) },
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				received = q
				return {
					rows: [{ dimensions: { source: 'google.com' }, metrics: { pageviews: 9 } }],
					meta: { provider: 'native', fetchedAt: NOW.toISOString() },
				}
			},
		})
		const result = await readForWidgetBreakdown({
			req: reqWith([adapter]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('ok')
		expect(received?.filters).toEqual([{ dimension: 'country', operator: 'eq', value: 'US' }])
	})

	it('answers filter-unsupported, without querying, when the adapter lacks the dimension', async () => {
		const adapter = breakdownAdapter()
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidgetBreakdown({
			req: reqWith([adapter]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	it('answers filter-unsupported when the operator is the part the adapter lacks', async () => {
		const adapter = breakdownAdapter({
			capabilities: { ...caps(), filters: new Set(['country']) },
		})
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidgetBreakdown({
			req: reqWith([adapter]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
			// caps() declares 'eq' alone.
			filters: [{ dimension: 'country', operator: 'contains', value: 'US' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	it('still answers unavailable when the breakdown dimension itself is unsupported', async () => {
		const result = await readForWidgetBreakdown({
			req: reqWith([
				breakdownAdapter({ capabilities: { ...caps(), filters: new Set(['country']) } }),
			]),
			metric: 'pageviews',
			dimension: 'browser',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('unavailable')
	})

	it('hints the scope goal slugs on a goal read, so a provider knows what to count', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readForWidgetBreakdown({
			req: reqWith([recordingAdapter(seen, goalCaps())], [goal('signup'), goal('purchase')]),
			metric: 'conversions',
			dimension: 'goal',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toEqual(['signup', 'purchase'])
		expect(result.rows).toEqual([{ label: 'signup', value: 3 }])
	})

	it('prefers the slugs the caller already resolved over resolving them again', async () => {
		const seen: AnalyticsQuery[] = []
		await readForWidgetBreakdown({
			req: reqWith([recordingAdapter(seen, goalCaps())], [goal('signup')]),
			metric: 'conversions',
			dimension: 'goal',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
			goalSlugs: ['from-caller'],
		})
		expect(seen[0]?.goalSlugs).toEqual(['from-caller'])
	})

	// A goal read a resolver could not answer is a read without rows, never a read that
	// silently counts every event the source has, and never one that shares the cache key of
	// a scope whose goals resolved.
	it('hints the failure but still reads when the goals resolver throws', async () => {
		const seen: AnalyticsQuery[] = []
		const payload = {} as PayloadRequest['payload']
		setRuntime(payload, {
			registry: createRegistry([recordingAdapter(seen, goalCaps())]),
			configAdapterIds: new Set(['native']),
			bindings: {},
			engine: { read: async (adapter, query) => adapter.query(query, {}) },
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: true,
			resolveGoals: () => Promise.reject(new Error('boom')),
		})
		const result = await readForWidgetBreakdown({
			req: { payload } as PayloadRequest,
			metric: 'conversions',
			dimension: 'goal',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})

	// The widget shows a setup notice for this, which it cannot tell from a window in which
	// nobody converted unless the read says which of the two it answered.
	it('reports a goal read of a scope that configures no goals', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readForWidgetBreakdown({
			req: reqWith([recordingAdapter(seen, goalCaps())]),
			metric: 'conversions',
			dimension: 'goal',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toEqual([])
		expect(result.noGoals).toBe(true)
	})

	it('leaves a non-goal read of a scope with no goals unflagged', async () => {
		const result = await readForWidgetBreakdown({
			req: reqWith([breakdownAdapter()]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(result.noGoals).toBe(false)
	})

	it('leaves a read that is about no goal unhinted', async () => {
		const seen: AnalyticsQuery[] = []
		await readForWidgetBreakdown({
			req: reqWith([recordingAdapter(seen, goalCaps())], [goal('signup')]),
			metric: 'pageviews',
			dimension: 'source',
			timeframe: 'last30days',
			limit: 5,
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBeUndefined()
	})
})
