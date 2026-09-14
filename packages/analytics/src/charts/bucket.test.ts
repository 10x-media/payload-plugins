import { describe, expect, it } from 'vitest'
import { bucketByRange, bucketSeries, onPrimaryAxis } from './bucket'

const day = (iso: string, value: number) => ({ date: `${iso}T00:00:00.000Z`, value })

describe('bucketSeries', () => {
	it('labels last7days by weekday, one bucket per day', () => {
		const pts = [day('2026-06-01', 1), day('2026-06-02', 2), day('2026-06-03', 3)]
		const out = bucketSeries(pts, 'last7days')
		expect(out.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed'])
		expect(out.map((b) => b.value)).toEqual([1, 2, 3])
	})

	it('aggregates a year into monthly buckets labelled by month', () => {
		const pts = [day('2026-01-10', 5), day('2026-01-20', 5), day('2026-02-05', 8)]
		const out = bucketSeries(pts, 'thisYear')
		expect(out.map((b) => b.label)).toEqual(['Jan', 'Feb'])
		expect(out.map((b) => b.value)).toEqual([10, 8])
	})

	it('labels a 30-day window by date', () => {
		const out = bucketSeries([day('2026-06-01', 4)], 'last30days')
		expect(out[0]?.label).toBe('Jun 1')
		expect(out[0]?.value).toBe(4)
	})

	it('labels days in the reporting timezone, not UTC (east of UTC)', () => {
		// Berlin is UTC+2 in summer, so its day starts are 22:00Z the previous calendar day.
		// A point stamped at Berlin's Jun 18 midnight must read as "Jun 18", not UTC "Jun 17".
		const pts = [{ date: '2026-06-17T22:00:00.000Z', value: 7 }]
		const out = bucketSeries(pts, 'last30days', 'Europe/Berlin')
		expect(out[0]?.label).toBe('Jun 18')
		expect(out[0]?.value).toBe(7)
	})

	it('groups weeks on the reporting-timezone week start (east of UTC)', () => {
		// Two Berlin days in the same ISO week (Mon Jun 15 and Wed Jun 17, 2026) must share one
		// weekly bucket keyed to that week's Berlin Monday, even though their UTC instants fall
		// on the previous UTC calendar day.
		const pts = [
			{ date: '2026-06-14T22:00:00.000Z', value: 3 }, // Berlin Mon Jun 15
			{ date: '2026-06-16T22:00:00.000Z', value: 4 }, // Berlin Wed Jun 17
		]
		const out = bucketSeries(pts, 'last90days', 'Europe/Berlin')
		expect(out).toHaveLength(1)
		expect(out[0]?.value).toBe(7)
		expect(out[0]?.label).toBe('Jun 15')
	})
})

describe('bucketByRange', () => {
	const day = (iso: string, value: number) => ({ date: `${iso}T00:00:00.000Z`, value })
	it('buckets a <=31 day span by day', () => {
		const out = bucketByRange([day('2026-06-01', 4)], {
			start: new Date('2026-06-01T00:00:00.000Z'),
			end: new Date('2026-06-20T00:00:00.000Z'),
		})
		expect(out[0]?.label).toBe('Jun 1')
		expect(out[0]?.value).toBe(4)
	})
	it('buckets a multi-month span by month', () => {
		const out = bucketByRange([day('2026-01-10', 5), day('2026-02-05', 8)], {
			start: new Date('2026-01-01T00:00:00.000Z'),
			end: new Date('2026-06-01T00:00:00.000Z'),
		})
		expect(out.map((b) => b.label)).toEqual(['Jan', 'Feb'])
	})
})

describe('onPrimaryAxis', () => {
	const series = (start: string, days: number, value: number) =>
		Array.from({ length: days }, (_, i) => ({
			date: new Date(new Date(`${start}T00:00:00.000Z`).getTime() + i * 86_400_000).toISOString(),
			value,
		}))

	it('buckets a 90-day comparison onto the primary week boundaries', () => {
		// Jun 16 is a Tuesday, so the window's first week is partial: bucketed on its own
		// Mar 18 start the previous window splits into a different number of weeks.
		const primary = series('2026-06-16', 90, 2)
		const comparison = series('2026-03-18', 90, 1)
		const primaryBuckets = bucketSeries(primary, 'last90days')
		const aligned = bucketSeries(onPrimaryAxis(comparison, primary), 'last90days')
		expect(aligned).toHaveLength(primaryBuckets.length)
		expect(aligned.map((b) => b.label)).toEqual(primaryBuckets.map((b) => b.label))
		expect(aligned.reduce((a, b) => a + b.value, 0)).toBe(90)
	})

	it('keeps its own date where the axis is shorter', () => {
		const out = onPrimaryAxis(series('2026-03-18', 2, 1), series('2026-06-16', 1, 2))
		expect(out[0]?.date).toBe('2026-06-16T00:00:00.000Z')
		expect(out[1]?.date).toBe('2026-03-19T00:00:00.000Z')
	})
})
