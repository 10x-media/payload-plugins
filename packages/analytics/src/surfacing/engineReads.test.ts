import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsRow } from '../core/contract'
import { refusedFilter, UnsupportedFilterError } from '../core/sourceErrors'
import { memoryAdapter } from '../testing/memoryAdapter'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { createEngine } from './engine'
import { createLanes } from './lanes'

const engineFor = (payload?: Payload) =>
	createEngine({
		store: memoryCacheStore(),
		ttl: { aggregate: 60, realtime: 5 },
		timeoutMs: 15_000,
		...(payload ? { payload } : {}),
	})

/**
 * A day-granular source answering one row per day of 2026, each with 10 pageviews and 4
 * visitors, the first half of the year at one second a pageview and the second at three.
 */
const yearOfDays = () => {
	const seen: AnalyticsQuery[] = []
	const contexts: unknown[] = []
	const adapter: AnalyticsAdapter = {
		id: 'days',
		label: 'Days',
		capabilities: {
			...memoryAdapter().capabilities,
			minGranularity: 'day',
			metrics: new Set(['pageviews', 'visitors', 'avgDuration']),
		},
		isConfigured: () => true,
		query: async (query, ctx) => {
			seen.push(query)
			contexts.push(ctx.payload)
			const rows: AnalyticsRow[] = []
			for (let day = 0; day < 365; day++) {
				const at = new Date(Date.UTC(2026, 0, 1 + day))
				const all = { pageviews: 10, visitors: 4, avgDuration: day < 181 ? 1000 : 3000 }
				rows.push({
					timestamp: at.toISOString(),
					metrics: Object.fromEntries(
						query.metrics.map((metric) => [metric, all[metric as keyof typeof all]])
					),
				})
			}
			return { rows, totals: { pageviews: 3650 }, meta: { provider: 'days', fetchedAt: '' } }
		},
	}
	return { adapter, seen, contexts }
}

const year = {
	start: new Date('2026-01-01T00:00:00.000Z'),
	end: new Date('2026-12-31T23:59:59.999Z'),
}

describe('createEngine reads for one source', () => {
	it('hands the adapter the Payload instance the engine was built for', async () => {
		const payload = { secret: 'p' } as unknown as Payload
		const { adapter, contexts } = yearOfDays()
		await engineFor(payload).read(adapter, { metrics: ['pageviews'], dateRange: year })
		expect(contexts[0]).toBe(payload)
	})

	it('draws a year by month as twelve points, not one: the source is read by day', async () => {
		const { adapter, seen } = yearOfDays()
		const result = await engineFor().read(adapter, {
			metrics: ['pageviews', 'visitors'],
			dateRange: year,
			granularity: 'month',
		})
		expect(seen[0]?.granularity).toBe('day')
		expect(result.rows).toHaveLength(12)
		expect(result.rows[0]).toEqual({
			timestamp: '2026-01-01T00:00:00.000Z',
			metrics: { pageviews: 310, visitors: 124 },
		})
		expect(result.rows[11]?.timestamp).toBe('2026-12-01T00:00:00.000Z')
		expect(result.meta.visitorsAre).toBe('sumOfDaily')
		expect(result.totals).toEqual({ pageviews: 3650 })
	})

	it('keys a folded read apart from the day read of the same window', async () => {
		const { adapter, seen } = yearOfDays()
		const engine = engineFor()
		const monthly = await engine.read(adapter, {
			metrics: ['pageviews'],
			dateRange: year,
			granularity: 'month',
		})
		const daily = await engine.read(adapter, {
			metrics: ['pageviews'],
			dateRange: year,
			granularity: 'day',
		})
		expect(seen).toHaveLength(2)
		expect(monthly.rows).toHaveLength(12)
		expect(daily.rows).toHaveLength(365)
	})

	it('asks for the count an average is weighed by, and answers without it', async () => {
		const { adapter, seen } = yearOfDays()
		const result = await engineFor().read(adapter, {
			metrics: ['avgDuration'],
			dateRange: year,
			granularity: 'month',
		})
		expect(seen[0]?.metrics).toEqual(['avgDuration', 'pageviews'])
		expect(result.rows[0]?.metrics).toEqual({ avgDuration: 1000 })
		expect(result.rows[0]?.samples).toEqual({ avgDuration: 310 })
		expect(result.totals).toEqual({})
	})

	it('leaves weeks and months to a source that answers them itself', async () => {
		const { adapter, seen } = yearOfDays()
		const own: AnalyticsAdapter = {
			...adapter,
			capabilities: { ...adapter.capabilities, calendarBuckets: true },
		}
		await engineFor().read(own, { metrics: ['pageviews'], dateRange: year, granularity: 'week' })
		expect(seen[0]?.granularity).toBe('week')
	})

	it('refuses a filter pair the source does not take before the cache or the adapter', async () => {
		const { adapter, seen } = yearOfDays()
		const failure = await engineFor()
			.read(adapter, {
				metrics: ['pageviews'],
				dateRange: year,
				filters: [{ dimension: 'page', operator: 'contains', value: '/a' }],
			})
			.catch((err: unknown) => err)
		expect(failure).toBeInstanceOf(UnsupportedFilterError)
		expect(String(failure)).toMatch(/cannot filter page with contains/)
		expect(refusedFilter(failure)).toEqual({ dimension: 'page', operator: 'contains' })
		expect(refusedFilter(new Error('other'))).toBeUndefined()
		expect(seen).toEqual([])
	})

	it('says where a clamped read starts', async () => {
		const { adapter } = yearOfDays()
		const limited: AnalyticsAdapter = {
			...adapter,
			capabilities: { ...adapter.capabilities, maxLookbackDays: 30 },
		}
		const result = await engineFor().read(limited, {
			metrics: ['pageviews'],
			dateRange: {
				start: new Date('2025-06-30T00:00:00.000Z'),
				end: new Date('2026-06-30T00:00:00.000Z'),
			},
		})
		expect(result.meta.clamped).toBe(true)
		expect(result.meta.dataFrom).toBe('2026-05-31T00:00:00.000Z')
	})
})

describe('createEngine read priority', () => {
	it("gives a slow source's freed slot to an interactive read before reads that name no priority", async () => {
		const started: string[] = []
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const adapter: AnalyticsAdapter = {
			...memoryAdapter(),
			id: 'slow',
			query: async (query) => {
				started.push(query.path ?? '')
				await gate
				return { rows: [], totals: {}, meta: { provider: 'slow', fetchedAt: '' } }
			},
		}
		const engine = createEngine({
			store: memoryCacheStore(),
			ttl: { aggregate: 60, realtime: 5 },
			timeoutMs: 15_000,
			lanes: createLanes({ perSource: 1 }),
		})
		const read = (path: string, options: { priority?: 'interactive' } = {}) =>
			engine.read(adapter, { metrics: ['pageviews'], path, dateRange: year }, options)
		const first = read('/stat-1')
		await vi.waitFor(() => expect(started).toEqual(['/stat-1']))
		const waiting = [read('/stat-2'), read('/panel', { priority: 'interactive' })]
		await new Promise((resolve) => setTimeout(resolve, 50))
		release()
		await Promise.all([first, ...waiting])
		expect(started).toEqual(['/stat-1', '/panel', '/stat-2'])
	})
})
