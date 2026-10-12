import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForField } from './readForDocument'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const recordingAdapter = (seen: AnalyticsQuery[]): AnalyticsAdapter => ({
	id: 'goals',
	label: 'Goals',
	capabilities: { ...memoryAdapter().capabilities, metrics: new Set(['conversions']) },
	isConfigured: () => true,
	async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		seen.push(q)
		return { rows: [], totals: { conversions: 0 }, meta: { provider: 'goals', fetchedAt: '' } }
	},
})

const reqFor = (
	adapter: AnalyticsAdapter,
	over: Partial<AnalyticsRuntime> = {}
): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: { pages: { pathField: 'slug', scopeField: false } },
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
		...over,
	})
	return { payload } as PayloadRequest
}

/** A request whose goals resolver fails, the way a missing collection index arrives. */
const reqWithFailingGoals = (adapter: AnalyticsAdapter): PayloadRequest =>
	reqFor(adapter, { resolveGoals: () => Promise.reject(new Error('boom')) })

describe('readForField', () => {
	// The sentinel is what keeps a failed resolver off the healthy cache key, so every
	// read path has to hand it to the adapter rather than flattening it to an empty hint.
	it('passes the failed-resolver sentinel through to the adapter', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readForField({
			req: reqWithFailingGoals(recordingAdapter(seen)),
			collectionSlug: 'pages',
			data: { slug: '/pricing' },
			metrics: ['conversions'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})
})

const base = memoryAdapter().capabilities

/** A source that answers one ranked row per dimension, recording what it was asked. */
const breakdownAdapter = (
	seen: AnalyticsQuery[],
	caps: Partial<AnalyticsAdapter['capabilities']> = {}
): AnalyticsAdapter => ({
	id: 'ranked',
	label: 'Ranked',
	capabilities: {
		...base,
		realtime: true,
		metrics: new Set(['pageviews', 'visitors']),
		dimensions: new Set(['country', 'device']),
		filters: { page: ['eq'] },
		...caps,
	},
	isConfigured: () => true,
	realtime: async () => ({ rows: [], meta: { provider: 'ranked', fetchedAt: '' } }),
	async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
		seen.push(q)
		const dimension = q.dimensions?.[0]
		return {
			rows: dimension ? [{ dimensions: { [dimension]: 'DE' }, metrics: { visitors: 4 } }] : [],
			totals: { visitors: 9 },
			meta: { provider: 'ranked', fetchedAt: '', sampled: true },
		}
	},
})

const readPage = (adapter: AnalyticsAdapter, over: Record<string, unknown> = {}) =>
	readForField({
		req: reqFor(adapter),
		collectionSlug: 'pages',
		data: { slug: '/pricing' },
		metrics: ['visitors'],
		timeframe: 'last30days',
		now: NOW,
		dimensions: ['country', 'device'],
		...over,
	})

describe('readForField breakdowns', () => {
	// The per-page report cannot group by a second dimension, so the narrowing has to be a
	// filter; asking for both would give the source two contradictory ways to read one page.
	it('narrows each dimension with a page filter rather than the per-page path', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readPage(breakdownAdapter(seen))
		const ranked = seen.filter((q) => q.dimensions !== undefined)
		expect(ranked).toHaveLength(2)
		for (const query of ranked) {
			expect(query.path).toBeUndefined()
			expect(query.filters).toEqual([{ dimension: 'page', operator: 'eq', value: '/pricing' }])
		}
		expect(result.breakdowns?.map((b) => b.dimension)).toEqual(['country', 'device'])
		expect(result.breakdowns?.[0]?.rows).toEqual([{ value: 'DE', metric: 4 }])
		expect(result.breakdowns?.[0]?.sampled).toBe(true)
	})

	it("reads a page's visits from a source that serves the count as sessions", async () => {
		const seen: AnalyticsQuery[] = []
		const sessions: AnalyticsAdapter = {
			...breakdownAdapter(seen),
			capabilities: { ...breakdownAdapter(seen).capabilities, metrics: new Set(['sessions']) },
			async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
				seen.push(q)
				return { rows: [], totals: { sessions: 3 }, meta: { provider: 'ranked', fetchedAt: '' } }
			},
		}
		const result = await readPage(sessions, { metrics: ['visits'], dimensions: [] })
		expect(result.status).toBe('ok')
		expect(seen[0]?.metrics).toEqual(['sessions'])
		expect(result.supportedMetrics).toEqual(['visits'])
		expect(result.metrics).toEqual({ visits: 3 })
	})

	it('says what the totals read says about its numbers, beside them', async () => {
		const partial: AnalyticsAdapter = {
			...breakdownAdapter([]),
			async query() {
				return {
					rows: [],
					totals: { visitors: 9 },
					meta: {
						provider: 'ranked',
						fetchedAt: '',
						partial: { missingDays: 2 },
						asOf: '2026-06-24T11:58:00.000Z',
					},
				}
			},
		}
		const result = await readPage(partial, { dimensions: [] })
		expect(result.notices).toMatchObject({
			partial: true,
			capped: false,
			asOf: '2026-06-24T11:58:00.000Z',
		})
	})

	it('shows nothing at all for a source that cannot filter by page', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readPage(breakdownAdapter(seen, { filters: {} }))
		expect(result.breakdowns).toBeUndefined()
		expect(seen.every((q) => q.dimensions === undefined)).toBe(true)
	})

	it('drops a dimension the source cannot group by, keeping the rest', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readPage(breakdownAdapter(seen, { dimensions: new Set(['country']) }))
		expect(result.breakdowns?.map((b) => b.dimension)).toEqual(['country'])
	})

	it('reports whether the source counts live visitors, so the panel knows to poll', async () => {
		const seen: AnalyticsQuery[] = []
		expect((await readPage(breakdownAdapter(seen))).realtime).toBe(true)
		expect((await readPage(breakdownAdapter(seen, { realtime: false }))).realtime).toBe(false)
	})
})

describe('readForField with a source that fails part of the panel', () => {
	/** Answers the totals, fails every other read the way an overloaded source times out. */
	const partlyFailing = (seen: AnalyticsQuery[]): AnalyticsAdapter => ({
		...breakdownAdapter(seen),
		async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
			seen.push(q)
			if (q.dimensions !== undefined || q.granularity !== undefined) {
				throw Object.assign(new Error('slow'), { name: 'ReadTimeoutError' })
			}
			return { rows: [], totals: { visitors: 9 }, meta: { provider: 'ranked', fetchedAt: '' } }
		},
	})

	it('keeps the headline numbers when the series and every list fail, and says some did', async () => {
		const result = await readPage(partlyFailing([]), { series: true })
		expect(result.status).toBe('ok')
		expect(result.metrics).toEqual({ visitors: 9 })
		expect(result.points).toBeUndefined()
		expect(result.breakdowns).toBeUndefined()
		expect(result.incomplete).toBe(true)
	})

	it('asks for the headline before any list, so the lists never hold its slot', async () => {
		const seen: AnalyticsQuery[] = []
		await readPage(breakdownAdapter(seen))
		expect(seen[0]?.dimensions).toBeUndefined()
		expect(seen.slice(1).every((query) => query.dimensions !== undefined)).toBe(true)
	})

	it('says a source busy for now is busy, with how long to wait, rather than unavailable', async () => {
		const busy: AnalyticsAdapter = {
			...breakdownAdapter([]),
			async query(): Promise<AnalyticsResult> {
				throw Object.assign(new Error('slow down'), { status: 429, retryAfterMs: 7000 })
			},
		}
		const result = await readPage(busy)
		expect(result.status).toBe('busy')
		expect(result.retryAfterMs).toBe(7000)
	})

	it('refuses a custom range longer than the query cap before reading anything', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readPage(breakdownAdapter(seen), {
			range: { start: new Date('2024-01-01'), end: new Date('2026-06-01') },
		})
		expect(result.status).toBe('range-too-long')
		expect(seen).toHaveLength(0)
	})
})
