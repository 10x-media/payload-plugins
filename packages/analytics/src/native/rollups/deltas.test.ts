import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../ingest/normalizeEvent'
import { computeRollupDeltas } from './deltas'

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
	it('emits a per-page and a site bucket for a pageview with no geo', () => {
		const deltas = computeRollupDeltas(ev({ durationMs: 500 }))
		expect(deltas).toHaveLength(2)
		const page = deltas.find((d) => d.key.path === '/p' && d.key.dimension === '')
		const site = deltas.find((d) => d.key.path === '' && d.key.dimension === '')
		expect(page?.key).toEqual({
			granularity: 'day',
			period: new Date('2026-01-10T00:00:00Z'),
			path: '/p',
			dimension: '',
			dimvalue: '',
		})
		expect(page?.inc).toEqual({ pageviews: 1, events: 0, durationMs: 500, samples: 1 })
		expect(site?.inc).toEqual({ pageviews: 1, events: 0, durationMs: 500, samples: 1 })
	})

	it('counts an event-type hit under events, not pageviews, in every bucket', () => {
		const deltas = computeRollupDeltas(ev({ type: 'event' }))
		expect(deltas).toHaveLength(2)
		for (const d of deltas) {
			expect(d.inc).toEqual({ pageviews: 0, events: 1, durationMs: 0, samples: 1 })
		}
	})

	it('adds a site-wide country bucket when geo is present', () => {
		const deltas = computeRollupDeltas(ev({ country: 'US', durationMs: 500 }))
		expect(deltas).toHaveLength(3)
		const country = deltas.find((d) => d.key.dimension === 'country')
		expect(country?.key).toEqual({
			granularity: 'day',
			period: new Date('2026-01-10T00:00:00Z'),
			path: '',
			dimension: 'country',
			dimvalue: 'US',
		})
		expect(country?.inc).toEqual({ pageviews: 1, events: 0, durationMs: 500, samples: 1 })
	})

	it('omits the country bucket when geo is unavailable', () => {
		const deltas = computeRollupDeltas(ev({}))
		expect(deltas.some((d) => d.key.dimension === 'country')).toBe(false)
	})
})
