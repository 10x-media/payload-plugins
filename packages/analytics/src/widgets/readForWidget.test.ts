import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import { plausible } from '../adapters/plausible/plausible'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
	MetricKey,
} from '../core/contract'
import { HostRefusedError } from '../core/sourceErrors'
import { createEngine } from '../surfacing/engine'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { readForWidget } from './readForWidget'
import { requestWith } from './widgetTestKit'

const NOW = new Date('2026-06-01T00:00:00Z')

describe('readForWidget', () => {
	it('keeps the number when only the comparison read fails, dropping the delta', async () => {
		const base = memoryAdapter()
		const comparing: AnalyticsAdapter = {
			...base,
			async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
				if (q.dateRange.end.getTime() < NOW.getTime() - 86_400_000) {
					throw new ProviderHttpError(503, 'memory', 'down')
				}
				return { rows: [], totals: { pageviews: 4 }, meta: { provider: 'memory', fetchedAt: '' } }
			},
		}
		const result = await readForWidget({
			req: requestWith([comparing]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(4)
		expect(result.previousMetrics).toBeUndefined()
		expect(result.comparisonRange).toBeUndefined()
	})

	it('refuses a saved custom range longer than the query cap, visibly, reading nothing', async () => {
		const adapter = memoryAdapter()
		const query = vi.spyOn(adapter, 'query')
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			range: { start: new Date('2020-01-01T00:00:00Z'), end: NOW },
			now: NOW,
		})
		expect(result.status).toBe('range-too-long')
		expect(query).not.toHaveBeenCalled()
	})

	it('returns ok with totals from the default adapter', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/test', timestamp: new Date('2026-05-15T12:00:00Z') })
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBeGreaterThanOrEqual(1)
		expect(result.adapterId).toBe(adapter.id)
	})

	// A widget saved with `visits` keeps reading once its source names that count `sessions`.
	it('reads visits from a source that serves the count as sessions, under the name asked for', async () => {
		const seen: AnalyticsQuery[] = []
		const base = memoryAdapter()
		const sessionsOnly: AnalyticsAdapter = {
			...base,
			id: 'native-like',
			capabilities: {
				...base.capabilities,
				metrics: new Set<MetricKey>(['pageviews', 'sessions']),
			},
			async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
				seen.push(q)
				return {
					rows: [],
					totals: { sessions: 6 },
					meta: { provider: 'native-like', fetchedAt: '2026-05-31T00:00:00.000Z' },
				}
			},
		}
		const result = await readForWidget({
			req: requestWith([sessionsOnly]),
			metrics: ['visits'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(seen[0]?.metrics).toEqual(['sessions'])
		expect(result.metrics).toEqual({ visits: 6 })
		expect(result.previousMetrics).toEqual({ visits: 6 })
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
			req: requestWith([adapter]),
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
				metrics: new Set<MetricKey>(['pageviews']),
			},
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return { rows: [], meta: { provider: 'limited', fetchedAt: new Date().toISOString() } }
			},
		}
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['scrollDepth'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	// A widget saved on time on page against a vendor that only measures time per visit keeps
	// its meaning and reads as unavailable, rather than showing the other number under its name.
	it('reads a saved time on page widget on a Plausible source as unavailable, without a request', async () => {
		const source = plausible({ siteId: 's', apiKey: 'k' })
		const query = vi.spyOn(source, 'query')
		const result = await readForWidget({
			req: requestWith([source]),
			metrics: ['avgDuration'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
		expect(query).not.toHaveBeenCalled()
	})

	it('reads a metric needing a page only once the widget filters by page', async () => {
		const source = plausible({ siteId: 's', apiKey: 'k' })
		const query = vi.spyOn(source, 'query').mockResolvedValue({
			rows: [],
			totals: { scrollDepth: 40 },
			meta: { provider: 'plausible', fetchedAt: NOW.toISOString() },
		})
		const whole = await readForWidget({
			req: requestWith([source]),
			metrics: ['scrollDepth'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(whole.status).toBe('unavailable')
		const onePage = await readForWidget({
			req: requestWith([source]),
			metrics: ['scrollDepth'],
			timeframe: 'last30days',
			filters: [{ dimension: 'page', operator: 'eq', value: '/pricing' }],
			now: NOW,
			comparison: false,
		})
		expect(onePage).toMatchObject({ status: 'ok', metrics: { scrollDepth: 40 } })
		expect(query).toHaveBeenCalledTimes(1)
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

	it('says a source refused as set up, and a refused host as such, rather than unavailable', async () => {
		const failing = (err: Error): AnalyticsAdapter => ({
			...memoryAdapter(),
			query: async () => {
				throw err
			},
		})
		const statusFor = async (err: Error) =>
			(
				await readForWidget({
					req: requestWith([failing(err)]),
					metrics: ['pageviews'],
					timeframe: 'last30days',
					now: NOW,
					comparison: false,
				})
			).status
		expect(await statusFor(new HostRefusedError('https://stats.internal', 'unlisted'))).toBe(
			'host-refused'
		)
		expect(await statusFor(new ProviderHttpError(401, 'memory', 'bad key'))).toBe('misconfigured')
		expect(await statusFor(new ProviderHttpError(503, 'memory', 'down'))).toBe('busy')
		expect(await statusFor(new ProviderHttpError(400, 'memory', 'bad filter'))).toBe('invalid')
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
			req: requestWith([stub('primary', 1), stub('secondary', 2)]),
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
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.comparisonRange).toBeDefined()
		expect(result.previousMetrics?.pageviews).toBe(1)
	})

	it('skips the previous-window read when the caller asks for no comparison', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/c', timestamp: new Date('2026-05-30T12:00:00Z') })
		adapter.record({ path: '/c', timestamp: new Date('2026-05-24T12:00:00Z') })
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
			comparison: false,
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(1)
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousMetrics).toBeUndefined()
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
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousMetrics).toBeUndefined()
	})

	it('omits comparison when the previous window falls outside the source lookback', async () => {
		const base = memoryAdapter()
		const adapter: AnalyticsAdapter = {
			id: 'short-lookback',
			label: 'Short lookback',
			capabilities: { ...base.capabilities, maxLookbackDays: 7 },
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return {
					rows: [],
					totals: { pageviews: 3 },
					meta: { provider: 'short-lookback', fetchedAt: NOW.toISOString() },
				}
			},
		}
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousMetrics).toBeUndefined()
	})

	it('keeps comparison when the previous window still fits the source lookback', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/c', timestamp: new Date('2026-05-30T12:00:00Z') })
		adapter.record({ path: '/c', timestamp: new Date('2026-05-24T12:00:00Z') })
		const scoped: AnalyticsAdapter = {
			...adapter,
			capabilities: { ...adapter.capabilities, maxLookbackDays: 30 },
		}
		const result = await readForWidget({
			req: requestWith([scoped]),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.comparisonRange).toBeDefined()
		expect(result.previousMetrics?.pageviews).toBe(1)
	})

	it('returns unavailable for an unknown adapterId', async () => {
		const result = await readForWidget({
			req: requestWith([memoryAdapter()]),
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
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			filters: [{ dimension: 'page', operator: 'eq', value: '/a' }],
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(1)
	})

	it('answers filter-unsupported, without querying, when the adapter lacks the dimension', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	it('answers filter-unsupported when the dimension is supported but the operator is not', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
			// memoryAdapter filters `page` with `eq` alone.
			filters: [{ dimension: 'page', operator: 'matches', value: '^/a$' }],
		})
		expect(result.status).toBe('filter-unsupported')
		expect(spy).not.toHaveBeenCalled()
	})

	it('still answers unavailable when the metric itself is missing, filter or no filter', async () => {
		const base = memoryAdapter()
		const adapter: AnalyticsAdapter = {
			id: 'limited',
			label: 'Limited',
			capabilities: {
				...base.capabilities,
				metrics: new Set<MetricKey>(['pageviews']),
			},
			isConfigured: () => true,
			async query(_q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				return { rows: [], meta: { provider: 'limited', fetchedAt: NOW.toISOString() } }
			},
		}
		const result = await readForWidget({
			req: requestWith([adapter]),
			metrics: ['scrollDepth'],
			timeframe: 'last30days',
			now: NOW,
			filters: [{ dimension: 'country', operator: 'eq', value: 'US' }],
		})
		expect(result.status).toBe('unavailable')
	})

	it('forwards filters into the engine query, producing a distinct cache key', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/a', timestamp: new Date('2026-05-15T12:00:00Z') })
		const engine = createEngine({
			store: memoryCacheStore(),
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 15_000,
		})
		const req = requestWith([adapter], { engine, comparison: false })
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

	// The sentinel is what keeps a failed resolver off the healthy cache key, so every
	// helper has to hand it to the adapter rather than flattening it to an empty hint.
	it('passes the failed-resolver sentinel through to the adapter', async () => {
		const seen: AnalyticsQuery[] = []
		const adapter: AnalyticsAdapter = {
			id: 'goals',
			label: 'Goals',
			capabilities: {
				...memoryAdapter().capabilities,
				metrics: new Set<MetricKey>(['conversions']),
			},
			isConfigured: () => true,
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				seen.push(q)
				return { rows: [], meta: { provider: 'goals', fetchedAt: NOW.toISOString() } }
			},
		}
		const result = await readForWidget({
			req: requestWith([adapter], {
				comparison: false,
				resolveGoals: () => Promise.reject(new Error('boom')),
			}),
			metrics: ['conversions'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})

	it('flags a goal read on a scope with no goals as noGoals, never as unresolved', async () => {
		const seen: AnalyticsQuery[] = []
		const adapter: AnalyticsAdapter = {
			id: 'goals',
			label: 'Goals',
			capabilities: {
				...memoryAdapter().capabilities,
				metrics: new Set<MetricKey>(['pageviews', 'conversions']),
			},
			isConfigured: () => true,
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				seen.push(q)
				return { rows: [], meta: { provider: 'goals', fetchedAt: NOW.toISOString() } }
			},
		}
		const req = requestWith([adapter], {
			comparison: false,
			resolveGoals: () => Promise.resolve([]),
		})
		const goals = await readForWidget({
			req,
			metrics: ['conversions'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toEqual([])
		expect(goals).toMatchObject({ status: 'ok', noGoals: true, goalsUnresolved: false })
		const plain = await readForWidget({
			req,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(seen[1]?.goalSlugs).toBeUndefined()
		expect(plain).toMatchObject({ status: 'ok', noGoals: false })
	})
})
