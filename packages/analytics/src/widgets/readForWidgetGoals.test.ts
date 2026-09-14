import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	MetricKey,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import type { Goal } from '../goals/types'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { setRuntime } from '../plugin/runtime'
import { resolveTimeframe } from '../timeframe/presets'
import { readForWidgetGoals } from './readForWidgetGoals'

const NOW = new Date('2026-06-03T12:00:00.000Z')
const RANGE = resolveTimeframe('last30days', NOW, 'UTC')

const caps = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsCapabilities => ({
	perPageQuery: true,
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set<MetricKey>(['conversions', 'revenue', 'visitors']),
	dimensions: new Set(['goal']),
	filters: new Set(),
	filterOperators: new Set(['eq']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
	...over,
})

type GoalMetrics = Record<string, Partial<Record<MetricKey, number>>>

const CURRENT: GoalMetrics = {
	purchase: { conversions: 5, revenue: 250, visitors: 4 },
	newsletter: { conversions: 9, revenue: 0, visitors: 8 },
	thanks: { conversions: 2, revenue: 0, visitors: 2 },
}

// `purchase` sits below two goals that have since gone quiet, so a previous window read
// under the widget's own row cap would rank it out and cost the row its delta.
const PREVIOUS: GoalMetrics = {
	purchase: { conversions: 3, revenue: 100, visitors: 3 },
	newsletter: { conversions: 12, revenue: 0, visitors: 11 },
	'legacy-a': { conversions: 11, revenue: 0, visitors: 10 },
	'legacy-b': { conversions: 10, revenue: 0, visitors: 9 },
}

const goals: Goal[] = [
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
	{ slug: 'newsletter', name: 'Newsletter', match: { kind: 'event', name: 'newsletter_signup' } },
]

interface AdapterOptions {
	capabilities?: AnalyticsCapabilities
	isConfigured?: boolean
	clamped?: boolean
	/** Marks the site-totals read (no dimensions) as stale-served. */
	staleTotals?: boolean
	queries?: AnalyticsQuery[]
}

const goalsAdapter = (opts: AdapterOptions = {}): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: opts.capabilities ?? caps(),
	isConfigured: () => opts.isConfigured ?? true,
	async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		opts.queries?.push(q)
		const pick = (values: Partial<Record<MetricKey, number>>) =>
			Object.fromEntries(
				q.metrics.flatMap((m) => (values[m] === undefined ? [] : [[m, values[m]]]))
			) as Partial<Record<MetricKey, number>>
		const meta = {
			provider: 'native',
			fetchedAt: NOW.toISOString(),
			...(opts.clamped ? { clamped: true } : {}),
		}
		if (q.dimensions?.includes('goal')) {
			const source = q.dateRange.start < RANGE.start ? PREVIOUS : CURRENT
			// Ranks and caps like a real source, so a row the query's own limit excludes is
			// genuinely absent from the answer.
			const rows = Object.entries(source)
				.sort(([, a], [, b]) => (b.conversions ?? 0) - (a.conversions ?? 0))
				.slice(0, q.limit ?? Number.POSITIVE_INFINITY)
				.map(([goal, values]) => ({ dimensions: { goal }, metrics: pick(values) }))
			return { rows, meta }
		}
		return {
			rows: [],
			totals: pick({ visitors: 100, conversions: 16, revenue: 250 }),
			meta: { ...meta, ...(opts.staleTotals ? { stale: true } : {}) },
		}
	},
})

const reqWith = (
	adapter: AnalyticsAdapter,
	over: Partial<AnalyticsRuntime> = {}
): PayloadRequest => {
	const payload = {} as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		goals,
		...over,
	})
	return { payload } as PayloadRequest
}

const read = (req: PayloadRequest, over: { limit?: number; compare?: boolean } = {}) =>
	readForWidgetGoals({
		req,
		timeframe: 'last30days',
		limit: over.limit ?? 10,
		compare: over.compare ?? false,
		now: NOW,
	})

describe('readForWidgetGoals', () => {
	it('shapes one row per goal, ordered by conversions desc, named from the resolved goals', async () => {
		const result = await read(reqWith(goalsAdapter()))
		expect(result.status).toBe('ok')
		expect(result.rows.map((r) => [r.slug, r.name, r.conversions])).toEqual([
			['newsletter', 'Newsletter', 9],
			['purchase', 'Purchase', 5],
			// No configured goal carries this slug, so the slug stands in for the name.
			['thanks', 'thanks', 2],
		])
	})

	it('divides each goal bucket by the site visitors for the rate', async () => {
		const result = await read(reqWith(goalsAdapter()))
		expect(result.siteVisitors).toBe(100)
		expect(result.rows.map((r) => r.rate)).toEqual([0.08, 0.04, 0.02])
	})

	it('carries revenue per goal', async () => {
		const result = await read(reqWith(goalsAdapter()))
		expect(result.rows.map((r) => r.revenue)).toEqual([0, 250, 0])
	})

	it('limits the rows it returns', async () => {
		const result = await read(reqWith(goalsAdapter()), { limit: 2 })
		expect(result.rows.map((r) => r.slug)).toEqual(['newsletter', 'purchase'])
	})

	it('leaves out the rate when the source does not serve visitors', async () => {
		const capabilities = caps({ metrics: new Set<MetricKey>(['conversions', 'revenue']) })
		const queries: AnalyticsQuery[] = []
		const result = await read(reqWith(goalsAdapter({ capabilities, queries })))
		expect(result.status).toBe('ok')
		expect(result.siteVisitors).toBeUndefined()
		expect(result.rows.every((r) => r.rate === undefined)).toBe(true)
		expect(queries.every((q) => !q.metrics.includes('visitors'))).toBe(true)
	})

	it('leaves out revenue when the source does not serve it', async () => {
		const capabilities = caps({ metrics: new Set<MetricKey>(['conversions', 'visitors']) })
		const queries: AnalyticsQuery[] = []
		const result = await read(reqWith(goalsAdapter({ capabilities, queries })))
		expect(result.status).toBe('ok')
		expect(result.rows.every((r) => r.revenue === undefined)).toBe(true)
		expect(queries.every((q) => !q.metrics.includes('revenue'))).toBe(true)
	})

	it('joins the previous window by slug when comparing', async () => {
		const result = await read(reqWith(goalsAdapter()), { compare: true })
		expect(result.rows.map((r) => [r.slug, r.previousConversions])).toEqual([
			['newsletter', 12],
			['purchase', 3],
			// Absent from the previous window: no baseline, so no delta.
			['thanks', undefined],
		])
	})

	it('reads the previous window past the row cap so a new entrant keeps its delta', async () => {
		const queries: AnalyticsQuery[] = []
		const result = await read(reqWith(goalsAdapter({ queries })), { limit: 2, compare: true })
		expect(result.rows.map((r) => [r.slug, r.previousConversions])).toEqual([
			['newsletter', 12],
			// Fourth by previous conversions: a limit-2 previous read would have missed it.
			['purchase', 3],
		])
		const previousQuery = queries.find(
			(q) => q.dimensions?.includes('goal') && q.dateRange.start < RANGE.start
		)
		expect(previousQuery?.limit).toBe(8)
	})

	it('issues one read per window: two uncompared, three compared', async () => {
		const uncompared: AnalyticsQuery[] = []
		await read(reqWith(goalsAdapter({ queries: uncompared })))
		expect(uncompared).toHaveLength(2)
		const compared: AnalyticsQuery[] = []
		await read(reqWith(goalsAdapter({ queries: compared })), { compare: true })
		expect(compared).toHaveLength(3)
	})

	it('skips the previous window when the source cannot compare', async () => {
		const capabilities = caps({ comparison: false })
		const result = await read(reqWith(goalsAdapter({ capabilities })), { compare: true })
		expect(result.rows.every((r) => r.previousConversions === undefined)).toBe(true)
	})

	it('skips the previous window when compare is off', async () => {
		const result = await read(reqWith(goalsAdapter()))
		expect(result.rows.every((r) => r.previousConversions === undefined)).toBe(true)
	})

	it('resolves names through resolveGoalsDetailed for the read scope', async () => {
		const seen: Array<string | null | undefined> = []
		const req = reqWith(goalsAdapter({ capabilities: caps({ scopedQueries: true }) }), {
			goals: [],
			scoped: true,
			resolveScope: async () => 'alpha',
			resolveGoalsDetailed: async (_req, scope) => {
				seen.push(scope)
				return [
					{
						goal: { slug: 'purchase', name: 'Alpha purchase', match: { kind: 'goal' } },
						source: 'collection',
					},
				]
			},
		})
		const result = await read(req)
		expect(seen).toEqual(['alpha'])
		expect(result.rows.find((r) => r.slug === 'purchase')?.name).toBe('Alpha purchase')
	})

	it('falls back to slugs when the goals resolution throws', async () => {
		const req = reqWith(goalsAdapter(), {
			resolveGoalsDetailed: async () => {
				throw new Error('lookup failed')
			},
		})
		const result = await read(req)
		expect(result.status).toBe('ok')
		expect(result.rows.map((r) => r.name)).toEqual(['newsletter', 'purchase', 'thanks'])
	})

	it('reports unavailable when the source lacks the goal dimension', async () => {
		const capabilities = caps({ dimensions: new Set() })
		const result = await read(reqWith(goalsAdapter({ capabilities })))
		expect(result.status).toBe('unavailable')
		expect(result.rows).toEqual([])
	})

	it('reports unavailable when the source lacks conversions', async () => {
		const capabilities = caps({ metrics: new Set<MetricKey>(['visitors']) })
		const result = await read(reqWith(goalsAdapter({ capabilities })))
		expect(result.status).toBe('unavailable')
	})

	it('reports not-configured when the source is not configured', async () => {
		const result = await read(reqWith(goalsAdapter({ isConfigured: false })))
		expect(result.status).toBe('not-configured')
	})

	it('reports unavailable without a booted runtime', async () => {
		const result = await read({ payload: {} as PayloadRequest['payload'] } as PayloadRequest)
		expect(result.status).toBe('unavailable')
		expect(result.timezone).toBe('UTC')
	})

	it('propagates clamped from the reads', async () => {
		const result = await read(reqWith(goalsAdapter({ clamped: true })))
		expect(result.clamped).toBe(true)
	})

	it('propagates stale from either read', async () => {
		const result = await read(reqWith(goalsAdapter({ staleTotals: true })))
		expect(result.stale).toBe(true)
	})

	it('reads both windows in the same resolved timezone', async () => {
		const req = reqWith(goalsAdapter(), { resolveTimezone: async () => 'Europe/Berlin' })
		const result = await read(req, { compare: true })
		expect(result.timezone).toBe('Europe/Berlin')
		expect(result.dateRange).toEqual(resolveTimeframe('last30days', NOW, 'Europe/Berlin'))
	})
})
