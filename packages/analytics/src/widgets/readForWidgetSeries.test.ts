import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	fillCalendarSeries,
	fillDailySeries,
	fillHourlySeries,
	seriesGranularityFor,
} from '../charts/series'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	Granularity,
} from '../core/contract'
import { createEngine } from '../surfacing/engine'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { readForWidgetSeries } from './readForWidgetSeries'
import { requestWith } from './widgetTestKit'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const baseCaps = (minGranularity: Granularity = 'day'): AnalyticsCapabilities => ({
	realtime: false,
	comparison: false,
	minGranularity,
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(),
	filters: {},
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

	// A day nothing happened has no average to show, so the line breaks there instead of
	// claiming a zero-second visit.
	it('fills an average with null, not zero, where a day has no reading', () => {
		const points = fillDailySeries({
			rows: [
				{ timestamp: '2026-06-01T00:00:00.000Z', metrics: { avgDuration: 4000 } },
				{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { avgDuration: null } },
			],
			dateRange: { start: new Date('2026-06-01T00:00:00.000Z'), end: NOW },
			metric: 'avgDuration',
		})
		expect(points.map((point) => point.value)).toEqual([4000, null, null])
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

	// A vendor labels a day by its date at UTC midnight, which west of UTC is the evening before.
	it("files a vendor's day on its own date west of UTC, as it files the engine's", () => {
		const dateRange = {
			start: new Date('2026-06-01T07:00:00.000Z'),
			end: new Date('2026-06-04T06:59:59.999Z'),
		}
		const axis = [
			'2026-06-01T07:00:00.000Z',
			'2026-06-02T07:00:00.000Z',
			'2026-06-03T07:00:00.000Z',
		]
		const vendor = fillDailySeries({
			rows: [
				{ timestamp: '2026-06-01T00:00:00.000Z', metrics: { pageviews: 3 } },
				{ timestamp: '2026-06-03', metrics: { pageviews: 5 } },
			],
			dateRange,
			metric: 'pageviews',
			tz: 'America/Los_Angeles',
		})
		expect(vendor).toEqual([
			{ date: axis[0], value: 3 },
			{ date: axis[1], value: 0 },
			{ date: axis[2], value: 5 },
		])
		const engine = fillDailySeries({
			rows: [
				{ timestamp: '2026-06-01T07:00:00.000Z', metrics: { pageviews: 3 } },
				{ timestamp: '2026-06-03T07:00:00.000Z', metrics: { pageviews: 5 } },
			],
			dateRange,
			metric: 'pageviews',
			tz: 'America/Los_Angeles',
		})
		expect(engine).toEqual(vendor)
	})

	it('leaves out a row whose timestamp names no day', () => {
		const points = fillDailySeries({
			rows: [{ timestamp: 'not a day', metrics: { pageviews: 9 } }],
			dateRange: { start: new Date('2026-06-03T00:00:00.000Z'), end: NOW },
			metric: 'pageviews',
		})
		expect(points).toEqual([{ date: '2026-06-03T00:00:00.000Z', value: 0 }])
	})
})

describe('fillHourlySeries', () => {
	it('zero-fills the requested hourly window in order', () => {
		const points = fillHourlySeries({
			rows: [{ timestamp: '2026-06-03T11:20:00.000Z', metrics: { pageviews: 5 } }],
			dateRange: { start: new Date('2026-06-03T10:00:00.000Z'), end: NOW },
			metric: 'pageviews',
		})
		expect(points).toEqual([
			{ date: '2026-06-03T10:00:00.000Z', value: 0 },
			{ date: '2026-06-03T11:00:00.000Z', value: 5 },
			{ date: '2026-06-03T12:00:00.000Z', value: 0 },
		])
	})

	it('floors hours on a half-hour offset zone', () => {
		const points = fillHourlySeries({
			rows: [{ timestamp: '2026-06-03T11:40:00.000Z', metrics: { pageviews: 2 } }],
			dateRange: {
				start: new Date('2026-06-03T11:30:00.000Z'),
				end: new Date('2026-06-03T11:45:00.000Z'),
			},
			metric: 'pageviews',
			tz: 'Asia/Kolkata',
		})
		expect(points).toEqual([{ date: '2026-06-03T11:30:00.000Z', value: 2 }])
	})
})

describe('fillCalendarSeries', () => {
	it('zero-fills weeks from the Monday holding the first day', () => {
		const points = fillCalendarSeries({
			rows: [{ timestamp: '2026-05-25T00:00:00.000Z', metrics: { pageviews: 6 } }],
			dateRange: { start: new Date('2026-05-20T00:00:00.000Z'), end: NOW },
			metric: 'pageviews',
			unit: 'week',
		})
		expect(points).toEqual([
			{ date: '2026-05-18T00:00:00.000Z', value: 0 },
			{ date: '2026-05-25T00:00:00.000Z', value: 6 },
			{ date: '2026-06-01T00:00:00.000Z', value: 0 },
		])
	})

	it('files a week the source dated by any of its days under its Monday', () => {
		const points = fillCalendarSeries({
			rows: [{ timestamp: '2026-05-27', metrics: { pageviews: 2 } }],
			dateRange: { start: new Date('2026-05-25T00:00:00.000Z'), end: NOW },
			metric: 'pageviews',
			unit: 'week',
		})
		expect(points[0]).toEqual({ date: '2026-05-25T00:00:00.000Z', value: 2 })
	})

	it('starts months on the first in the reporting timezone and caps the axis like days', () => {
		const points = fillCalendarSeries({
			rows: [{ timestamp: '2026-05-31T22:00:00.000Z', metrics: { avgDuration: 3000 } }],
			dateRange: { start: new Date(0), end: NOW },
			metric: 'avgDuration',
			tz: 'Europe/Berlin',
			unit: 'month',
		})
		expect(points).toHaveLength(13)
		expect(points.at(-1)).toEqual({ date: '2026-05-31T22:00:00.000Z', value: 3000 })
		expect(points.at(-2)?.value).toBeNull()
	})
})

describe('seriesGranularityFor', () => {
	const range = (hours: number) => ({
		start: new Date(NOW.getTime() - hours * 3_600_000),
		end: NOW,
	})

	it('reads a quarter by week and a year by month from a source that serves days', () => {
		expect(seriesGranularityFor(range(24 * 90), baseCaps('day'))).toBe('week')
		expect(seriesGranularityFor(range(24 * 365), baseCaps('day'))).toBe('month')
	})

	it('reads a day-or-two window by hour where the source serves hours', () => {
		expect(seriesGranularityFor(range(24), baseCaps('hour'))).toBe('hour')
		expect(seriesGranularityFor(range(24), baseCaps('minute'))).toBe('hour')
	})

	it('falls back to a day when the source buckets no finer', () => {
		expect(seriesGranularityFor(range(24), baseCaps('day'))).toBe('day')
	})

	it('reads a longer window by day even from an hourly source', () => {
		expect(seriesGranularityFor(range(24 * 30), baseCaps('hour'))).toBe('day')
	})
})

describe('readForWidgetSeries', () => {
	it('returns ok with zero-filled points and the headline total', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([seriesAdapter()]),
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

	it('charts visits from a source that serves the count as sessions', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([
				seriesAdapter({
					capabilities: { ...baseCaps(), metrics: new Set(['sessions']) },
					query: async () => ({
						rows: [{ timestamp: '2026-06-03T00:00:00.000Z', metrics: { sessions: 4 } }],
						totals: { sessions: 4 },
						meta: { provider: 'native', fetchedAt: NOW.toISOString() },
					}),
				}),
			]),
			metric: 'visits',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.total).toBe(4)
		expect(result.points.at(-1)).toEqual({ date: '2026-06-03T00:00:00.000Z', value: 4 })
	})

	it('keeps a headline average with no samples null rather than zero', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([
				seriesAdapter({
					capabilities: { ...baseCaps(), metrics: new Set(['avgDuration']) },
					query: async () => ({
						rows: [{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { avgDuration: null } }],
						totals: { avgDuration: null },
						meta: { provider: 'native', fetchedAt: NOW.toISOString() },
					}),
				}),
			]),
			metric: 'avgDuration',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.total).toBeNull()
		expect(result.points.every((point) => point.value === null)).toBe(true)
	})

	it('returns previous-window comparison data when the adapter supports it', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
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
			req: requestWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
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
			req: requestWith([adapter]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
			compare: true,
		})
		expect(received).toEqual(['day', 'day'])
	})

	it('omits the comparison series when compare is not asked for', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([seriesAdapter({ capabilities: { ...baseCaps(), comparison: true } })]),
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
			req: requestWith([adapter]),
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
			req: requestWith([seriesAdapter()]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.comparisonRange).toBeUndefined()
		expect(result.previousTotal).toBeUndefined()
	})

	it('returns unavailable when the adapter cannot bucket by day', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([seriesAdapter({ capabilities: baseCaps('month') })]),
			metric: 'pageviews',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(result.status).toBe('unavailable')
	})

	it('returns not-configured when the adapter is unconfigured', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([seriesAdapter({ isConfigured: () => false })]),
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
			capabilities: { ...baseCaps(), filters: { page: ['eq'] } },
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
			req: requestWith([adapter]),
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
			req: requestWith([adapter]),
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
			capabilities: { ...baseCaps(), filters: { page: ['eq'] } },
		})
		const spy = vi.spyOn(adapter, 'query')
		const result = await readForWidgetSeries({
			req: requestWith([adapter]),
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
		const result = await readForWidgetSeries({
			req: requestWith([adapter], {
				comparison: false,
				resolveGoals: () => Promise.reject(new Error('boom')),
			}),
			metric: 'conversions',
			timeframe: 'last7days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})

	// A day of one 1s visit and a day of three 4s ones is a week of 3.25s, not of 2.5s.
	it('reads a quarter by week from the engine, its average weighted by the days it folds', async () => {
		const asked: AnalyticsQuery[] = []
		const adapter = seriesAdapter({
			capabilities: { ...baseCaps(), metrics: new Set(['pageviews', 'avgDuration']) },
			async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
				asked.push(q)
				return {
					rows: [
						{ timestamp: '2026-06-01T00:00:00.000Z', metrics: { avgDuration: 1000, pageviews: 1 } },
						{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { avgDuration: 4000, pageviews: 3 } },
					],
					totals: { avgDuration: 3250, pageviews: 4 },
					meta: { provider: 'native', fetchedAt: NOW.toISOString() },
				}
			},
		})
		const engine = createEngine({
			store: memoryCacheStore(),
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 15_000,
		})
		const result = await readForWidgetSeries({
			req: requestWith([adapter], { engine, comparison: false }),
			metric: 'avgDuration',
			timeframe: 'last90days',
			now: NOW,
		})
		expect(result.status).toBe('ok')
		expect(result.seriesGranularity).toBe('week')
		// The engine asked the source for days, with the count each average is weighed by.
		expect(asked[0]?.granularity).toBe('day')
		expect(asked[0]?.metrics).toEqual(['avgDuration', 'pageviews'])
		expect(result.points.at(-1)).toEqual({ date: '2026-06-01T00:00:00.000Z', value: 3250 })
		expect(result.points.at(-1)?.value).not.toBe((1000 + 4000) / 2)
		expect(result.points.at(-2)?.value).toBeNull()
	})

	it('still answers unavailable when day granularity is what the adapter lacks', async () => {
		const result = await readForWidgetSeries({
			req: requestWith([
				seriesAdapter({
					capabilities: { ...baseCaps(), filters: { page: ['eq'] }, minGranularity: 'month' },
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
