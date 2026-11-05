import { describe, expect, it } from 'vitest'
import type { AnalyticsRow } from './contract'
import {
	combineMetricValues,
	emptyReading,
	isAverageMetric,
	NO_VALUE,
	sortRowsByMetric,
} from './metricValues'

describe('isAverageMetric', () => {
	it('names the averages and shares, and nothing that counts', () => {
		expect(isAverageMetric('avgDuration')).toBe(true)
		expect(isAverageMetric('visitDuration')).toBe(true)
		expect(isAverageMetric('scrollDepth')).toBe(true)
		expect(isAverageMetric('bounceRate')).toBe(true)
		expect(isAverageMetric('pageviews')).toBe(false)
		expect(isAverageMetric('revenue')).toBe(false)
	})
})

describe('emptyReading', () => {
	it('is zero for a count and null for an average', () => {
		expect(emptyReading('visitors')).toBe(0)
		expect(emptyReading('scrollDepth')).toBeNull()
	})
})

describe('combineMetricValues', () => {
	it('adds counts up', () => {
		expect(combineMetricValues('pageviews', [3, 4, 5])).toBe(12)
		expect(combineMetricValues('pageviews', [])).toBe(0)
	})

	// Summing a week of daily averages would report seven times the average.
	it('averages averages over the readings that have one', () => {
		expect(combineMetricValues('avgDuration', [1000, null, 3000])).toBe(2000)
		expect(combineMetricValues('scrollDepth', [null, null])).toBeNull()
		expect(combineMetricValues('bounceRate', [])).toBeNull()
	})
})

describe('sortRowsByMetric', () => {
	const rows: AnalyticsRow[] = [
		{ dimensions: { page: '/none' }, metrics: { avgDuration: null } },
		{ dimensions: { page: '/short' }, metrics: { avgDuration: 1000 } },
		{ dimensions: { page: '/unread' }, metrics: {} },
		{ dimensions: { page: '/long' }, metrics: { avgDuration: 9000 } },
	]
	const pages = (sorted: AnalyticsRow[]) => sorted.map((row) => row.dimensions?.page)

	it('ranks readings and puts the rows without one last, either way round', () => {
		expect(pages(sortRowsByMetric(rows, 'avgDuration', 'desc'))).toEqual([
			'/long',
			'/short',
			'/none',
			'/unread',
		])
		expect(pages(sortRowsByMetric(rows, 'avgDuration', 'asc'))).toEqual([
			'/short',
			'/long',
			'/none',
			'/unread',
		])
	})

	it('leaves the input untouched', () => {
		sortRowsByMetric(rows, 'avgDuration', 'desc')
		expect(rows[0]?.dimensions?.page).toBe('/none')
	})
})

describe('NO_VALUE', () => {
	it('is a plain hyphen, never a dash a screen reader names differently', () => {
		expect(NO_VALUE).toBe('-')
	})
})
