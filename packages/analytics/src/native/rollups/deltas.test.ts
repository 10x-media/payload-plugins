import { describe, expect, it } from 'vitest'
import type { StoredEvent } from '../ingest/normalizeEvent'
import { computeRollupDeltas } from './deltas'

const ev = (over: Partial<StoredEvent>): StoredEvent => ({
	timestamp: new Date('2026-01-10T13:45:00Z'),
	type: 'pageview',
	path: '/p',
	hostname: '',
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
			hostname: '',
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
			hostname: '',
		})
		expect(country?.inc).toEqual({ pageviews: 1, events: 0, durationMs: 500, samples: 1 })
	})

	it('omits the country bucket when geo is unavailable', () => {
		const deltas = computeRollupDeltas(ev({}))
		expect(deltas.some((d) => d.key.dimension === 'country')).toBe(false)
	})

	it('dual-emits a hostname-scoped clone of every bucket when hostname is set', () => {
		const deltas = computeRollupDeltas(ev({ country: 'US', hostname: 'a.example' }))
		// 3 buckets in the '' family (page, site, country) + 3 mirrored in the 'a.example' family.
		expect(deltas).toHaveLength(6)
		const withoutHostname = deltas.filter((d) => d.key.hostname === '')
		const withHostname = deltas.filter((d) => d.key.hostname === 'a.example')
		expect(withoutHostname).toHaveLength(3)
		expect(withHostname).toHaveLength(3)
		const bucketShape = (d: (typeof deltas)[number]) => ({
			path: d.key.path,
			dimension: d.key.dimension,
			dimvalue: d.key.dimvalue,
			inc: d.inc,
		})
		expect(withHostname.map(bucketShape).sort((a, b) => a.path.localeCompare(b.path))).toEqual(
			withoutHostname.map(bucketShape).sort((a, b) => a.path.localeCompare(b.path))
		)
	})

	it('emits only the hostname-less family when hostname is empty', () => {
		const deltas = computeRollupDeltas(ev({ country: 'US', hostname: '' }))
		expect(deltas).toHaveLength(3)
		expect(deltas.every((d) => d.key.hostname === '')).toBe(true)
	})

	it('buckets into the reporting-timezone day at ingest', () => {
		// 23:30Z on 2026-01-10 is 00:30 on the 11th in Berlin, so the rollup day is the 11th (local
		// midnight = 2026-01-10T23:00:00Z in CET).
		const deltas = computeRollupDeltas(
			ev({ timestamp: new Date('2026-01-10T23:30:00Z'), timezone: 'Europe/Berlin' })
		)
		for (const d of deltas) {
			expect(d.key.period.toISOString()).toBe('2026-01-10T23:00:00.000Z')
		}
	})

	it('falls back to the UTC day when no timezone is set', () => {
		const deltas = computeRollupDeltas(ev({ timestamp: new Date('2026-01-10T23:30:00Z') }))
		for (const d of deltas) {
			expect(d.key.period.toISOString()).toBe('2026-01-10T00:00:00.000Z')
		}
	})

	it('emits device and source buckets when present', () => {
		const deltas = computeRollupDeltas({
			timestamp: new Date('2026-06-01T10:00:00.000Z'),
			type: 'pageview',
			path: '/p',
			hostname: 'h',
			visitorHash: 'v',
			sessionId: 's',
			country: 'US',
			device: 'mobile',
			source: 'google.com',
		})
		const dims = deltas.map((d) => `${d.key.dimension}:${d.key.dimvalue}`)
		expect(dims).toEqual(
			expect.arrayContaining(['country:US', 'device:mobile', 'source:google.com'])
		)
	})

	it('emits an event-name bucket for a custom event with name', () => {
		const deltas = computeRollupDeltas(ev({ type: 'event', name: 'signup' }))
		expect(deltas).toHaveLength(3)
		const eventBucket = deltas.find((d) => d.key.dimension === 'event')
		expect(eventBucket?.key).toEqual({
			granularity: 'day',
			period: new Date('2026-01-10T00:00:00Z'),
			path: '',
			dimension: 'event',
			dimvalue: 'signup',
			hostname: '',
		})
		expect(eventBucket?.inc).toEqual({ pageviews: 0, events: 1, durationMs: 0, samples: 1 })
	})

	it('does not emit an event bucket for a pageview', () => {
		const deltas = computeRollupDeltas(ev({ type: 'pageview' }))
		expect(deltas.some((d) => d.key.dimension === 'event')).toBe(false)
	})

	it('does not emit an event bucket for a nameless custom event', () => {
		const deltas = computeRollupDeltas(ev({ type: 'event' }))
		expect(deltas.some((d) => d.key.dimension === 'event')).toBe(false)
	})

	it('dual-emits the event-name bucket when hostname is set', () => {
		const deltas = computeRollupDeltas(ev({ type: 'event', name: 'signup', hostname: 'a.example' }))
		// 3 buckets in the '' family (page, site, event) + 3 mirrored in the 'a.example' family.
		expect(deltas).toHaveLength(6)
		const withoutHostname = deltas.filter((d) => d.key.hostname === '')
		const withHostname = deltas.filter((d) => d.key.hostname === 'a.example')
		expect(withoutHostname).toHaveLength(3)
		expect(withHostname).toHaveLength(3)
		const eventBucketWithout = withoutHostname.find((d) => d.key.dimension === 'event')
		const eventBucketWith = withHostname.find((d) => d.key.dimension === 'event')
		expect(eventBucketWithout?.key.dimvalue).toBe('signup')
		expect(eventBucketWith?.key.dimvalue).toBe('signup')
	})
})
