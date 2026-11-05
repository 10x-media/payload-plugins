import { describe, expect, it } from 'vitest'
import { bucketLabel, labelSeries, unitForRange, unitForTimeframe } from './bucket'

const day = (iso: string, value: number | null) => ({ date: `${iso}T00:00:00.000Z`, value })
const hour = (iso: string, value: number) => ({ date: iso, value })

describe('unit rules', () => {
	it('charts today by hour and the long presets by week and month', () => {
		expect(unitForTimeframe('today')).toBe('hour')
		expect(unitForTimeframe('last30days')).toBe('day')
		expect(unitForTimeframe('last90days')).toBe('week')
		expect(unitForTimeframe('lastYear')).toBe('month')
	})

	it('picks a range unit by its span', () => {
		const span = (days: number) => ({
			start: new Date('2026-01-01T00:00:00.000Z'),
			end: new Date(Date.UTC(2026, 0, 1 + days)),
		})
		expect(unitForRange(span(1))).toBe('hour')
		expect(unitForRange(span(20))).toBe('day')
		expect(unitForRange(span(90))).toBe('week')
		expect(unitForRange(span(200))).toBe('month')
	})
})

describe('labelSeries', () => {
	it('labels hours by hour of day and keeps the day for the tooltip', () => {
		const out = labelSeries(
			[hour('2026-06-24T09:00:00.000Z', 3), hour('2026-06-24T10:00:00.000Z', 5)],
			{ granularity: 'hour' }
		)
		expect(out.slice(0, 2).map((b) => b.label)).toEqual(['9 AM', '10 AM'])
		expect(out.slice(0, 2).map((b) => b.value)).toEqual([3, 5])
		expect(out[0]?.tooltipLabel).toBe('Wed 9 AM')
	})

	// Today just after midnight has one hour of readings, which alone would span the whole axis.
	it('runs an hourly series on to the end of its day, the hours to come empty', () => {
		const out = labelSeries([hour('2026-10-09T07:00:00.000Z', 9)], {
			granularity: 'hour',
			tz: 'America/Los_Angeles',
		})
		expect(out).toHaveLength(24)
		expect(out[0]).toMatchObject({ label: '12 AM', value: 9 })
		expect(out[0]?.upcoming).toBeUndefined()
		expect(out.slice(1).every((b) => b.upcoming === true && b.value === null)).toBe(true)
		expect(out.at(-1)).toMatchObject({ at: '2026-10-10T06:00:00.000Z', label: '11 PM' })
		expect(out.at(-1)?.tooltipLabel).toBe('Fri 11 PM')
	})

	it('adds no hour to a series that already reaches the end of its day', () => {
		const out = labelSeries([hour('2026-10-09T23:00:00.000Z', 1)], { granularity: 'hour' })
		expect(out).toHaveLength(1)
		expect(labelSeries([day('2026-10-09', 1)], { granularity: 'day' })).toHaveLength(1)
	})

	it('keeps every hour of a day the clocks fall back in, the repeated one included', () => {
		const out = labelSeries([hour('2026-11-01T07:00:00.000Z', 1)], {
			granularity: 'hour',
			tz: 'America/Los_Angeles',
		})
		expect(out).toHaveLength(25)
		expect(out.map((b) => b.label).filter((label) => label === '1 AM')).toHaveLength(2)
		expect(new Set(out.map((b) => b.at)).size).toBe(25)
	})

	it('reads hours in the reporting timezone', () => {
		const out = labelSeries([hour('2026-06-24T09:00:00.000Z', 3)], {
			granularity: 'hour',
			tz: 'Europe/Berlin',
		})
		expect(out[0]?.label).toBe('11 AM')
	})

	it('identifies every bucket by its period start and folds nothing', () => {
		const out = labelSeries([day('2026-06-01', 1), day('2026-06-01', 2)], { granularity: 'day' })
		expect(out.map((b) => b.at)).toEqual(['2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'])
		expect(out.map((b) => b.value)).toEqual([1, 2])
	})

	it('labels the 7-day preset by weekday and other day windows by date', () => {
		const pts = [day('2026-06-01', 1), day('2026-06-02', 2)]
		expect(labelSeries(pts, { granularity: 'day', weekday: true }).map((b) => b.label)).toEqual([
			'Mon',
			'Tue',
		])
		expect(labelSeries(pts, { granularity: 'day' }).map((b) => b.label)).toEqual(['Jun 1', 'Jun 2'])
	})

	it('labels in the caller locale', () => {
		expect(
			labelSeries([day('2026-06-01', 1)], { granularity: 'day', tz: 'UTC', locale: 'de-DE' })[0]
				?.label
		).toBe('1. Juni')
	})

	it('labels days in the reporting timezone, not UTC (east of UTC)', () => {
		// Berlin is UTC+2 in summer, so its day starts are 22:00Z the previous calendar day.
		const out = labelSeries([{ date: '2026-06-17T22:00:00.000Z', value: 7 }], {
			granularity: 'day',
			tz: 'Europe/Berlin',
		})
		expect(out[0]?.label).toBe('Jun 18')
	})

	it('names a week by the date it starts on', () => {
		const out = labelSeries([{ date: '2026-06-14T22:00:00.000Z', value: 7 }], {
			granularity: 'week',
			tz: 'Europe/Berlin',
		})
		expect(out[0]?.label).toBe('Jun 15')
		expect(out[0]?.value).toBe(7)
	})

	// This year by week opens on the Monday before January 1, a date outside the range.
	it('names a first bucket that starts before the range by the day the range starts', () => {
		const weeks = [day('2025-12-29', 4), day('2026-01-05', 7)]
		const out = labelSeries(weeks, {
			granularity: 'week',
			from: new Date('2026-01-01T00:00:00.000Z'),
		})
		expect(out.map((b) => b.label)).toEqual(['Jan 1', 'Jan 5'])
		expect(out[0]?.at).toBe('2025-12-29T00:00:00.000Z')
		expect(labelSeries(weeks, { granularity: 'week' })[0]?.label).toBe('Dec 29')
	})

	it('names a month without its year until the series crosses one', () => {
		const year = [day('2026-01-01', 1), day('2026-02-01', 2)]
		expect(labelSeries(year, { granularity: 'month' }).map((b) => b.label)).toEqual(['Jan', 'Feb'])
		const crossing = [day('2025-12-01', 1), day('2026-01-01', 2)]
		expect(labelSeries(crossing, { granularity: 'month' }).map((b) => b.label)).toEqual([
			'Dec 2025',
			'Jan 2026',
		])
		expect(labelSeries(year, { granularity: 'month', year: 'always' })[0]?.label).toBe('Jan 2026')
	})

	it('keeps a bucket with no reading a gap', () => {
		expect(labelSeries([day('2026-01-01', null)], { granularity: 'month' })[0]?.value).toBeNull()
	})
})

describe('bucketLabel', () => {
	it('labels a minute with its hour', () => {
		expect(
			bucketLabel(new Date('2026-06-24T09:05:00.000Z'), { granularity: 'minute', tz: 'UTC' })
		).toBe('09:05 AM')
	})
})
