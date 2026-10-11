import { describe, expect, it } from 'vitest'
import { addCalendarDays, type CalendarDay } from '../../timeframe/calendar'
import { emptyParts, type MetricParts, partsToMetrics } from '../store/parts'
import {
	bucketInstant,
	bucketStartOf,
	bucketStarts,
	type DayParts,
	foldDays,
	nextBucketStart,
} from './buckets'

const parts = (over: Partial<MetricParts>): MetricParts => ({ ...emptyParts(), ...over })

const day = (date: CalendarDay, over: Partial<MetricParts>): DayParts => ({
	day: date,
	parts: parts(over),
})

/** Every day from `from` for `count` days, each with the same parts. */
const days = (from: CalendarDay, count: number, over: Partial<MetricParts>): DayParts[] =>
	Array.from({ length: count }, (_, i) => day(addCalendarDays(from, i), over))

describe('bucket starts', () => {
	it('starts a week on Monday and a month on its first', () => {
		expect(bucketStartOf(20260308, 'week')).toBe(20260302)
		expect(bucketStartOf(20260309, 'week')).toBe(20260309)
		expect(bucketStartOf(20260331, 'month')).toBe(20260301)
	})

	it('steps to the next bucket across a year', () => {
		expect(nextBucketStart(20261228, 'week')).toBe(20270104)
		expect(nextBucketStart(20261201, 'month')).toBe(20270101)
	})

	it('lists every bucket a range touches, the edges included', () => {
		expect(bucketStarts(20260304, 20260318, 'week')).toEqual([20260302, 20260309, 20260316])
		expect(bucketStarts(20260115, 20260402, 'month')).toEqual([
			20260101, 20260201, 20260301, 20260401,
		])
		expect(bucketStarts(20260101, 20261231, 'month')).toHaveLength(12)
	})
})

describe('bucketInstant across daylight saving', () => {
	it('starts New York weeks at local midnight on either side of the spring change', () => {
		// US clocks spring forward on Sunday 8 March 2026, inside the week of Monday the 2nd.
		const before = bucketInstant(20260302, 'America/New_York')
		const after = bucketInstant(20260309, 'America/New_York')
		expect(before.toISOString()).toBe('2026-03-02T05:00:00.000Z')
		expect(after.toISOString()).toBe('2026-03-09T04:00:00.000Z')
		expect((after.getTime() - before.getTime()) / 3_600_000).toBe(167)
	})

	it('starts Berlin weeks at local midnight on either side of the spring change', () => {
		// Europe springs forward on Sunday 29 March 2026, inside the week of Monday the 23rd.
		const before = bucketInstant(20260323, 'Europe/Berlin')
		const after = bucketInstant(20260330, 'Europe/Berlin')
		expect(before.toISOString()).toBe('2026-03-22T23:00:00.000Z')
		expect(after.toISOString()).toBe('2026-03-29T22:00:00.000Z')
		expect((after.getTime() - before.getTime()) / 3_600_000).toBe(167)
	})

	it('gives a month holding the autumn change its extra hour', () => {
		// Europe falls back on Sunday 25 October 2026.
		const october = bucketInstant(20261001, 'Europe/Berlin')
		const november = bucketInstant(20261101, 'Europe/Berlin')
		expect(october.toISOString()).toBe('2026-09-30T22:00:00.000Z')
		expect(november.toISOString()).toBe('2026-10-31T23:00:00.000Z')
		expect((november.getTime() - october.getTime()) / 3_600_000).toBe(31 * 24 + 1)
	})
})

describe('foldDays', () => {
	it('folds a week holding a daylight saving change into one bucket of seven days', () => {
		const folded = foldDays(days(20260302, 14, { pageviews: 2, visitors: 1 }), 'week')
		expect(folded.buckets.map(({ start, days: count }) => [start, count])).toEqual([
			[20260302, 7],
			[20260309, 7],
		])
		expect(folded.buckets[0]?.parts.pageviews).toBe(14)
	})

	it('folds a month across the autumn change exactly, its averages from parts', () => {
		const october = [
			...days(20261001, 24, { pageviews: 1, durationMs: 1000 }),
			...days(20261025, 7, { pageviews: 4, durationMs: 20_000 }),
		]
		const [bucket] = foldDays(october, 'month').buckets
		expect(bucket?.start).toBe(20261001)
		expect(bucket?.days).toBe(31)
		// (24 * 1000 + 7 * 20000) ms over 24 + 28 pageviews; the mean of daily means would be 1903.
		expect(partsToMetrics(bucket?.parts ?? emptyParts(), ['avgDuration'])).toEqual({
			avgDuration: Math.round(164_000 / 52),
		})
	})

	it('folds a year of days into twelve months, the "This year" chart', () => {
		const folded = foldDays(days(20260101, 365, { pageviews: 1 }), 'month')
		expect(folded.buckets).toHaveLength(12)
		expect(folded.buckets.map((bucket) => bucket.parts.pageviews)).toEqual([
			31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
		])
	})

	it('says a bucket of several days adds up daily visitors', () => {
		expect(foldDays(days(20260302, 2, { visitors: 3 }), 'week').visitorsAre).toBe('sumOfDaily')
		expect(foldDays(days(20260302, 2, { sessions: 3 }), 'week').visitorsAre).toBe('sumOfDaily')
	})

	it('keeps one day distinct, even across the rows of several hostnames', () => {
		expect(foldDays(days(20260302, 1, { visitors: 3 }), 'week').visitorsAre).toBe('distinct')
		const twoHosts = [day(20260302, { visitors: 3 }), day(20260302, { visitors: 2 })]
		const folded = foldDays(twoHosts, 'week')
		expect(folded.visitorsAre).toBe('distinct')
		expect(folded.buckets[0]?.parts.visitors).toBe(5)
		expect(folded.buckets[0]?.days).toBe(1)
	})

	it('says nothing about visitors for days that count none', () => {
		expect(foldDays(days(20260302, 7, { impressions: 3 }), 'week').visitorsAre).toBe('distinct')
	})

	it('keeps a part null when no day of the bucket counted it', () => {
		const [bucket] = foldDays(days(20260302, 3, { impressions: 2 }), 'week').buckets
		expect(bucket?.parts.impressions).toBe(6)
		expect(bucket?.parts.sessions).toBeNull()
	})

	it('orders buckets oldest first whatever order the days came in', () => {
		const folded = foldDays(
			[day(20260310, { pageviews: 1 }), day(20260303, { pageviews: 1 })],
			'week'
		)
		expect(folded.buckets.map((bucket) => bucket.start)).toEqual([20260302, 20260309])
	})
})
