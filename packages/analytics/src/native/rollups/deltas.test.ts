import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../ingest/normalizeEvent'
import { computeRollupDeltas, type RollupDelta } from './deltas'

const ev = (over: Partial<StoredEvent>): StoredEvent => ({
	timestamp: new Date('2026-01-10T13:45:00Z'),
	type: 'pageview',
	path: '/p',
	hostname: 'h',
	visitorHash: 'v',
	sessionId: 's',
	...over,
})

describe('computeRollupDeltas', () => {
	it('buckets a pageview to the UTC day and increments pageviews + samples', () => {
		const deltas = computeRollupDeltas(ev({ durationMs: 500 }))
		expect(deltas).toHaveLength(1)
		const d = deltas[0] as RollupDelta
		expect(d.key).toEqual({
			granularity: 'day',
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
			dimension: '',
			dimvalue: '',
		})
		expect(d.inc).toEqual({ pageviews: 1, events: 0, durationMs: 500, samples: 1 })
	})
	it('counts an event-type hit under events, not pageviews', () => {
		const deltas = computeRollupDeltas(ev({ type: 'event' }))
		expect(deltas).toHaveLength(1)
		const d = deltas[0] as RollupDelta
		expect(d.inc).toEqual({ pageviews: 0, events: 1, durationMs: 0, samples: 1 })
	})
})
