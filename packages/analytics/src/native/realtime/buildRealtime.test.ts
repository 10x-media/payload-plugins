import { describe, expect, it } from 'vitest'
import { buildRealtime, type RealtimeEvent } from './buildRealtime'

const ev = (over: Partial<RealtimeEvent>): RealtimeEvent => ({
	timestamp: '2026-06-24T10:05:30.000Z',
	type: 'pageview',
	visitorHash: 'a',
	...over,
})

const range = {
	start: new Date('2026-06-24T10:03:00.000Z'),
	end: new Date('2026-06-24T10:06:00.000Z'),
}

describe('buildRealtime', () => {
	it('counts distinct visitors and pageviews over the window', () => {
		const out = buildRealtime(
			[
				ev({ visitorHash: 'a', timestamp: '2026-06-24T10:05:10.000Z' }),
				ev({ visitorHash: 'a', timestamp: '2026-06-24T10:05:40.000Z' }),
				ev({ visitorHash: 'b', timestamp: '2026-06-24T10:04:10.000Z' }),
				ev({ visitorHash: 'c', type: 'event', timestamp: '2026-06-24T10:04:20.000Z' }),
			],
			range,
			['visitors', 'pageviews']
		)
		expect(out.totals).toEqual({ visitors: 3, pageviews: 3 })
	})
	it('emits one zero-filled row per minute across the window', () => {
		const out = buildRealtime([ev({ timestamp: '2026-06-24T10:05:10.000Z' })], range, ['pageviews'])
		expect(out.rows.map((r) => r.timestamp)).toEqual([
			'2026-06-24T10:03:00.000Z',
			'2026-06-24T10:04:00.000Z',
			'2026-06-24T10:05:00.000Z',
			'2026-06-24T10:06:00.000Z',
		])
		expect(out.rows.map((r) => r.metrics.pageviews)).toEqual([0, 0, 1, 0])
	})
	it('filters output metrics to the requested set', () => {
		const out = buildRealtime([ev({})], range, ['visitors'])
		expect(out.rows[2]?.metrics).toEqual({ visitors: 1 })
		expect(out.totals).toEqual({ visitors: 1 })
	})
})
