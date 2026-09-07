import { describe, expect, it } from 'vitest'
import type { Acc, RollupDoc } from './rollupAcc'
import { emptyAcc, selectMetrics, seriesFromRollups } from './rollupAcc'

const doc = (over: Partial<RollupDoc>): RollupDoc => ({
	path: '',
	dimvalue: '',
	period: '2026-06-01T00:00:00.000Z',
	pageviews: 0,
	events: 0,
	durationMs: 0,
	visitors: 0,
	sessions: 0,
	...over,
})

const acc = (over: Partial<Acc> = {}): Acc => ({ ...emptyAcc(), ...over })

describe('selectMetrics', () => {
	it('projects only the requested metrics and derives avgDuration', () => {
		expect(
			selectMetrics(acc({ pageviews: 4, events: 1, durationMs: 8000, visitors: 2, sessions: 3 }), [
				'pageviews',
				'avgDuration',
			])
		).toEqual({ pageviews: 4, avgDuration: 2000 })
	})

	it('avgDuration is 0 when there are no pageviews', () => {
		expect(selectMetrics(acc(), ['avgDuration'])).toEqual({ avgDuration: 0 })
	})

	it('serves conversions and revenue straight from the accumulator', () => {
		expect(
			selectMetrics(acc({ conversions: 3, revenue: 41.5 }), ['conversions', 'revenue'])
		).toEqual({ conversions: 3, revenue: 41.5 })
	})

	it('averages scrollDepth over the pageviews that reported one', () => {
		// 75 + 25 over two reporting pageviews, with a third pageview that never reported.
		expect(
			selectMetrics(acc({ pageviews: 3, scrollDepthSum: 100, scrollSamples: 2 }), ['scrollDepth'])
		).toEqual({ scrollDepth: 50 })
	})

	it('scrollDepth is 0 when no pageview reported a depth', () => {
		expect(selectMetrics(acc({ pageviews: 5 }), ['scrollDepth'])).toEqual({ scrollDepth: 0 })
	})
})

describe('seriesFromRollups', () => {
	it('returns one ascending row per UTC day with that day metrics', () => {
		const rows = seriesFromRollups(
			[
				doc({ period: '2026-06-02T00:00:00.000Z', pageviews: 5, visitors: 3 }),
				doc({ period: '2026-06-01T00:00:00.000Z', pageviews: 2, visitors: 2 }),
			],
			['pageviews', 'visitors']
		)
		expect(rows).toEqual([
			{ timestamp: '2026-06-01T00:00:00.000Z', metrics: { pageviews: 2, visitors: 2 } },
			{ timestamp: '2026-06-02T00:00:00.000Z', metrics: { pageviews: 5, visitors: 3 } },
		])
	})

	it('groups multiple docs in the same day and accepts Date periods', () => {
		const rows = seriesFromRollups(
			[
				doc({ period: new Date('2026-06-01T03:00:00.000Z'), pageviews: 1 }),
				doc({ period: new Date('2026-06-01T20:00:00.000Z'), pageviews: 4 }),
			],
			['pageviews']
		)
		expect(rows).toEqual([{ timestamp: '2026-06-01T00:00:00.000Z', metrics: { pageviews: 5 } }])
	})

	it('keeps timezone-bucketed periods aligned to that zone day', () => {
		// Periods are already Berlin-local midnights (22:00Z); flooring in Berlin is idempotent.
		const rows = seriesFromRollups(
			[
				doc({ period: '2026-07-13T22:00:00.000Z', pageviews: 2 }),
				doc({ period: '2026-07-14T22:00:00.000Z', pageviews: 5 }),
			],
			['pageviews'],
			'Europe/Berlin'
		)
		expect(rows).toEqual([
			{ timestamp: '2026-07-13T22:00:00.000Z', metrics: { pageviews: 2 } },
			{ timestamp: '2026-07-14T22:00:00.000Z', metrics: { pageviews: 5 } },
		])
	})
})
