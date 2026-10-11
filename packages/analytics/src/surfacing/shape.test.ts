import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow } from '../core/contract'
import { shapeResult } from './shape'

const query = (overrides: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['visitors', 'bounceRate'],
	dimensions: ['page'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
	...overrides,
})

const row = (
	page: string,
	visitors: number | null,
	bounceRate: number | null = null
): AnalyticsRow => ({
	dimensions: { page },
	metrics: { visitors, bounceRate },
})

const result = (rows: AnalyticsRow[]): AnalyticsResult => ({
	rows,
	meta: { provider: 'vendor', fetchedAt: '2026-01-31T00:00:00.000Z' },
})

const pages = (shaped: AnalyticsResult): Array<string | undefined> =>
	shaped.rows.map((entry) => entry.dimensions?.page)

describe('shapeResult', () => {
	it('cuts a vendor that ignored limit down to it, ranked by the order', () => {
		const shaped = shapeResult(
			result([row('/a', 1), row('/b', 9), row('/c', 5), row('/d', 7)]),
			query({ limit: 2, order: { metric: 'visitors', direction: 'desc' } })
		)
		expect(pages(shaped)).toEqual(['/b', '/d'])
	})

	it('puts rows with no value last whichever way the order runs, ties in the source order', () => {
		const rows = [row('/a', null, null), row('/b', 3, 40), row('/c', 1, null), row('/d', 3, 20)]
		expect(
			pages(shapeResult(result(rows), query({ order: { metric: 'bounceRate', direction: 'asc' } })))
		).toEqual(['/d', '/b', '/a', '/c'])
		expect(
			pages(shapeResult(result(rows), query({ order: { metric: 'visitors', direction: 'desc' } })))
		).toEqual(['/b', '/d', '/c', '/a'])
	})

	it('keeps the source order, cut to the limit, when no row carries the ordering metric', () => {
		const shaped = shapeResult(
			result([row('/a', 1), row('/b', 3), row('/c', 2)]),
			query({ metrics: ['visitors'], limit: 2, order: { metric: 'pageviews', direction: 'desc' } })
		)
		expect(pages(shaped)).toEqual(['/a', '/b'])
	})

	it('ranks by the first metric, descending, when a limit comes without an order', () => {
		const shaped = shapeResult(
			result([row('/a', 1), row('/b', 9), row('/c', 5)]),
			query({ limit: 2 })
		)
		expect(pages(shaped)).toEqual(['/b', '/c'])
	})

	it('leaves a series, a single-row read and a read asking for neither as they are', () => {
		const series = result([
			{ timestamp: '2026-01-02T00:00:00.000Z', metrics: { visitors: 1 } },
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { visitors: 9 } },
		])
		expect(shapeResult(series, query({ dimensions: [], limit: 1 }))).toBe(series)
		const breakdown = result([row('/a', 1), row('/b', 9)])
		expect(shapeResult(breakdown, query())).toBe(breakdown)
		const totals = result([{ metrics: { visitors: 3 } }])
		expect(shapeResult(totals, query({ dimensions: undefined, limit: 1 }))).toBe(totals)
	})

	it('copies the result rather than changing the one it was handed', () => {
		const rows = [row('/a', 1), row('/b', 9)]
		const original = result(rows)
		const shaped = shapeResult(original, query({ limit: 1 }))
		expect(pages(original)).toEqual(['/a', '/b'])
		expect(pages(shaped)).toEqual(['/b'])
	})
})
