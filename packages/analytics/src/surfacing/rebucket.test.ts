import { describe, expect, it } from 'vitest'
import type {
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	AnalyticsRow,
	Granularity,
	MetricKey,
} from '../core/contract'
import { addCalendarDays, calendarDayStart, formatCalendarDay } from '../timeframe/calendar'
import { dayOfTimestamp, dayRead, foldResult, rebucketPlan } from './rebucket'

const caps = (over: Partial<AnalyticsCapabilities> = {}): AnalyticsCapabilities => ({
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set<MetricKey>(['pageviews', 'visitors', 'visits', 'avgDuration', 'bounceRate']),
	dimensions: new Set(['page']),
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
	...over,
})

const query = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews'],
	dateRange: {
		start: new Date('2026-01-01T00:00:00.000Z'),
		end: new Date('2026-12-31T23:59:59.999Z'),
	},
	granularity: 'week',
	...over,
})

const result = (rows: AnalyticsRow[], totals?: AnalyticsResult['totals']): AnalyticsResult => ({
	rows,
	...(totals ? { totals } : {}),
	meta: { provider: 'vendor', fetchedAt: '2026-12-31T23:59:59.999Z' },
})

/** A vendor's day row, labelled by the date's UTC midnight as `dayIso` writes it. */
const vendorDay = (
	date: string,
	metrics: AnalyticsRow['metrics'],
	extra: Partial<AnalyticsRow> = {}
) => ({
	timestamp: `${date}T00:00:00.000Z`,
	metrics,
	...extra,
})

describe('rebucketPlan', () => {
	it('folds only weeks and months', () => {
		for (const granularity of ['minute', 'hour', 'day'] as Granularity[]) {
			expect(rebucketPlan(query({ granularity }), caps())).toBeUndefined()
		}
		expect(rebucketPlan(query({ granularity: undefined }), caps())).toBeUndefined()
		expect(rebucketPlan(query({ granularity: 'month' }), caps())).toEqual({
			unit: 'month',
			weights: [],
		})
	})

	it('leaves a source alone that answers weeks itself, or serves no days to fold', () => {
		expect(rebucketPlan(query(), caps({ calendarBuckets: true }))).toBeUndefined()
		expect(rebucketPlan(query(), caps({ minGranularity: 'week' }))).toBeUndefined()
	})

	it('adds the count each asked average is weighed by, once, when the source serves it', () => {
		expect(
			rebucketPlan(query({ metrics: ['avgDuration', 'bounceRate', 'scrollDepth'] }), caps())
				?.weights
		).toEqual(['pageviews', 'visits'])
		expect(rebucketPlan(query({ metrics: ['bounceRate', 'visits'] }), caps())?.weights).toEqual([])
		expect(
			rebucketPlan(
				query({ metrics: ['bounceRate', 'sessions'] }),
				caps({ metrics: new Set<MetricKey>(['bounceRate', 'visits', 'sessions']) })
			)?.weights
		).toEqual([])
		expect(
			rebucketPlan(
				query({ metrics: ['bounceRate'] }),
				caps({ metrics: new Set<MetricKey>(['bounceRate', 'sessions']) })
			)?.weights
		).toEqual(['sessions'])
		expect(
			rebucketPlan(query({ metrics: ['bounceRate'] }), caps({ metrics: new Set(['bounceRate']) }))
				?.weights
		).toEqual([])
	})

	it('reads days, with the weights beside the asked metrics', () => {
		const plan = { unit: 'week' as const, weights: ['pageviews' as const] }
		expect(dayRead(query({ metrics: ['avgDuration'] }), plan)).toMatchObject({
			granularity: 'day',
			metrics: ['avgDuration', 'pageviews'],
		})
	})
})

describe('dayOfTimestamp', () => {
	it('reads a vendor label as its own date, west of UTC too', () => {
		expect(dayOfTimestamp('2026-03-08T00:00:00.000Z', 'America/New_York')).toBe(20260308)
		expect(dayOfTimestamp('2026-03-08', 'America/New_York')).toBe(20260308)
	})

	it('reads the start of a local day as that local date, east and west of UTC', () => {
		expect(dayOfTimestamp('2026-03-28T23:00:00.000Z', 'Europe/Berlin')).toBe(20260329)
		expect(dayOfTimestamp('2026-03-08T05:00:00.000Z', 'America/New_York')).toBe(20260308)
	})

	it('reads nothing out of what is not a time', () => {
		expect(dayOfTimestamp('yesterday', 'UTC')).toBeNull()
	})
})

describe('foldResult', () => {
	const weekly = { unit: 'week' as const, weights: [] }

	it('adds counts up per week and dates each week by its local Monday', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { pageviews: 1 }),
				vendorDay('2026-03-08', { pageviews: 2 }),
				vendorDay('2026-03-09', { pageviews: 4 }),
			]),
			query({ timezone: 'America/New_York' }),
			weekly
		)
		expect(folded.rows).toEqual([
			{ timestamp: '2026-03-02T05:00:00.000Z', metrics: { pageviews: 3 } },
			{ timestamp: '2026-03-09T04:00:00.000Z', metrics: { pageviews: 4 } },
		])
	})

	it('buckets native day starts and vendor labels of one date alike, across the Berlin change', () => {
		const native = [20260323, 20260329, 20260330].map((date) => ({
			timestamp: calendarDayStart(date, 'Europe/Berlin').toISOString(),
			metrics: { pageviews: 1 },
		}))
		const vendor = [20260323, 20260329, 20260330].map((date) =>
			vendorDay(formatCalendarDay(date), { pageviews: 1 })
		)
		const q = query({ timezone: 'Europe/Berlin' })
		const expected = [
			{ timestamp: '2026-03-22T23:00:00.000Z', metrics: { pageviews: 2 } },
			{ timestamp: '2026-03-29T22:00:00.000Z', metrics: { pageviews: 1 } },
		]
		expect(foldResult(result(native), q, weekly).rows).toEqual(expected)
		expect(foldResult(result(vendor), q, weekly).rows).toEqual(expected)
	})

	it('folds a month across the autumn change into one bucket', () => {
		const october = Array.from({ length: 31 }, (_, i) =>
			vendorDay(formatCalendarDay(addCalendarDays(20261001, i)), { pageviews: 1 })
		)
		const folded = foldResult(result(october), query({ timezone: 'Europe/Berlin' }), {
			unit: 'month',
			weights: [],
		})
		expect(folded.rows).toEqual([
			{ timestamp: '2026-09-30T22:00:00.000Z', metrics: { pageviews: 31 } },
		])
	})

	it('folds a year of native days into twelve months in New York, the "This year" chart', () => {
		const year = Array.from({ length: 365 }, (_, i) => ({
			timestamp: calendarDayStart(addCalendarDays(20260101, i), 'America/New_York').toISOString(),
			metrics: { pageviews: 1 },
		}))
		const folded = foldResult(result(year), query({ timezone: 'America/New_York' }), {
			unit: 'month',
			weights: [],
		})
		expect(folded.rows).toHaveLength(12)
		expect(folded.rows.map((row) => row.metrics.pageviews)).toEqual([
			31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
		])
		expect(folded.rows[2]?.timestamp).toBe('2026-03-01T05:00:00.000Z')
		expect(folded.rows[3]?.timestamp).toBe('2026-04-01T04:00:00.000Z')
	})

	it('weighs an average by the samples a row reports first, its matching count after that', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { bounceRate: 50, visits: 2 }, { samples: { bounceRate: 10 } }),
				vendorDay('2026-03-03', { bounceRate: 100, visits: 30 }, { samples: { bounceRate: 30 } }),
				vendorDay('2026-03-09', { bounceRate: 20, visits: 1 }),
				vendorDay('2026-03-10', { bounceRate: 80, visits: 3 }),
			]),
			query({ metrics: ['bounceRate', 'visits'] }),
			weekly
		)
		expect(folded.rows.map((row) => [row.metrics.bounceRate, row.samples])).toEqual([
			[Math.round((50 * 10 + 100 * 30) / 40), { bounceRate: 40 }],
			[65, { bounceRate: 4 }],
		])
	})

	it('falls back to a plain mean when one reading has nothing to weigh it by', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { avgDuration: 1000, pageviews: 9 }),
				vendorDay('2026-03-03', { avgDuration: 3000 }),
			]),
			query({ metrics: ['avgDuration', 'pageviews'] }),
			weekly
		)
		expect(folded.rows[0]?.metrics).toEqual({ avgDuration: 2000, pageviews: 9 })
		expect(folded.rows[0]?.samples).toBeUndefined()
	})

	it('reads an average with no reading, or weighed by nothing, as no data', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { avgDuration: null, pageviews: 0 }),
				vendorDay('2026-03-09', { avgDuration: 500, pageviews: 0 }),
			]),
			query({ metrics: ['avgDuration', 'pageviews'] }),
			weekly
		)
		expect(folded.rows.map((row) => row.metrics.avgDuration)).toEqual([null, null])
	})

	it('drops the weights it added from every row and from the totals', () => {
		const folded = foldResult(
			result(
				[
					vendorDay('2026-03-02', { avgDuration: 1000, pageviews: 1 }),
					{ dimensions: { page: '/' }, metrics: { avgDuration: 2000, pageviews: 5 } },
				],
				{ avgDuration: 1800, pageviews: 6 }
			),
			query({ metrics: ['avgDuration'] }),
			{ unit: 'week', weights: ['pageviews'] }
		)
		expect(folded.rows).toEqual([
			{ dimensions: { page: '/' }, metrics: { avgDuration: 2000 } },
			{
				timestamp: '2026-03-02T00:00:00.000Z',
				metrics: { avgDuration: 1000 },
				samples: { avgDuration: 1 },
			},
		])
		expect(folded.totals).toEqual({ avgDuration: 1800 })
	})

	it('folds each dimension value of a split series on its own', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { pageviews: 1 }, { dimensions: { page: '/b' } }),
				vendorDay('2026-03-03', { pageviews: 2 }, { dimensions: { page: '/a' } }),
				vendorDay('2026-03-04', { pageviews: 3 }, { dimensions: { page: '/b' } }),
			]),
			query(),
			weekly
		)
		expect(folded.rows.map((row) => [row.dimensions?.page, row.metrics.pageviews])).toEqual([
			['/a', 2],
			['/b', 4],
		])
	})

	it('says visitors were added up only when a bucket held two days of them', () => {
		const twoDays = foldResult(
			result([vendorDay('2026-03-02', { visitors: 2 }), vendorDay('2026-03-03', { visitors: 3 })]),
			query({ metrics: ['visitors'] }),
			weekly
		)
		expect(twoDays.rows[0]?.metrics.visitors).toBe(5)
		expect(twoDays.meta.visitorsAre).toBe('sumOfDaily')
		const oneDayEach = foldResult(
			result([vendorDay('2026-03-02', { visitors: 2 }), vendorDay('2026-03-09', { visitors: 3 })]),
			query({ metrics: ['visitors'] }),
			weekly
		)
		expect(oneDayEach.meta.visitorsAre).toBeUndefined()
	})

	it('drops a day row whose timestamp names no time, keeping the rest', () => {
		const folded = foldResult(
			result([
				vendorDay('2026-03-02', { pageviews: 1 }),
				{ timestamp: 'soon', metrics: { pageviews: 9 } },
			]),
			query(),
			weekly
		)
		expect(folded.rows).toEqual([
			{ timestamp: '2026-03-02T00:00:00.000Z', metrics: { pageviews: 1 } },
		])
	})
})
