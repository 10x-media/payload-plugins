import { describe, expect, it } from 'vitest'
import type { RollupDoc } from './rollupAcc'
import { selectMetrics, seriesFromRollups } from './rollupAcc'

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

describe('selectMetrics', () => {
	it('projects only the requested metrics and derives avgDuration', () => {
		const acc = { pageviews: 4, events: 1, durationMs: 8000, visitors: 2, sessions: 3 }
		expect(selectMetrics(acc, ['pageviews', 'avgDuration'])).toEqual({
			pageviews: 4,
			avgDuration: 2000,
		})
	})

	it('avgDuration is 0 when there are no pageviews', () => {
		const acc = { pageviews: 0, events: 0, durationMs: 0, visitors: 0, sessions: 0 }
		expect(selectMetrics(acc, ['avgDuration'])).toEqual({ avgDuration: 0 })
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
})
