import { describe, expect, it } from 'vitest'
import { bucketByRange, bucketSeries } from './bucket'

const day = (iso: string, value: number) => ({ date: `${iso}T00:00:00.000Z`, value })

describe('bucketSeries', () => {
	it('labels last7days by weekday, one bucket per day', () => {
		const pts = [day('2026-06-01', 1), day('2026-06-02', 2), day('2026-06-03', 3)]
		const out = bucketSeries(pts, 'last7days', new Date('2026-06-03T12:00:00.000Z'))
		expect(out.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed'])
		expect(out.map((b) => b.value)).toEqual([1, 2, 3])
	})

	it('aggregates a year into monthly buckets labelled by month', () => {
		const pts = [day('2026-01-10', 5), day('2026-01-20', 5), day('2026-02-05', 8)]
		const out = bucketSeries(pts, 'thisYear', new Date('2026-02-10T00:00:00.000Z'))
		expect(out.map((b) => b.label)).toEqual(['Jan', 'Feb'])
		expect(out.map((b) => b.value)).toEqual([10, 8])
	})

	it('labels a 30-day window by date', () => {
		const out = bucketSeries(
			[day('2026-06-01', 4)],
			'last30days',
			new Date('2026-06-30T00:00:00.000Z')
		)
		expect(out[0]?.label).toBe('Jun 1')
		expect(out[0]?.value).toBe(4)
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
