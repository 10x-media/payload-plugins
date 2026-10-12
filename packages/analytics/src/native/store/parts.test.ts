import { describe, expect, it } from 'vitest'
import {
	addPart,
	addParts,
	emptyParts,
	type MetricParts,
	PART_KEYS,
	partsToMetrics,
	sumParts,
} from './parts'

const parts = (over: Partial<MetricParts>): MetricParts => ({ ...emptyParts(), ...over })

describe('metric parts', () => {
	it('lists every part, so a sum leaves none out', () => {
		expect([...PART_KEYS].sort()).toEqual(Object.keys(emptyParts()).sort())
		expect(Object.values(emptyParts()).every((part) => part === null)).toBe(true)
	})

	it('adds a part only where a row counts it: null and null stay null', () => {
		expect(addPart(null, null)).toBeNull()
		expect(addPart(null, 3)).toBe(3)
		expect(addPart(3, null)).toBe(3)
		expect(addPart(3, 4)).toBe(7)
		expect(addPart(0, null)).toBe(0)
	})

	it('adds two rows part by part without changing either', () => {
		const a = parts({ pageviews: 2, sessions: 1 })
		const b = parts({ pageviews: 3, impressions: 5 })
		expect(addParts(a, b)).toEqual(parts({ pageviews: 5, sessions: 1, impressions: 5 }))
		expect(a).toEqual(parts({ pageviews: 2, sessions: 1 }))
		expect(sumParts([a, b, a])).toEqual(parts({ pageviews: 7, sessions: 2, impressions: 5 }))
		expect(sumParts([])).toEqual(emptyParts())
	})
})

describe('partsToMetrics', () => {
	const week = sumParts([
		parts({
			pageviews: 1,
			durationMs: 1000,
			sessions: 1,
			entries: 1,
			bounces: 1,
			sessionMs: 1000,
			scrollSum: 40,
			scrollSamples: 1,
		}),
		parts({
			pageviews: 4,
			durationMs: 5000,
			sessions: 3,
			entries: 3,
			bounces: 0,
			sessionMs: 9000,
			scrollSum: 260,
			scrollSamples: 3,
		}),
	])

	it('weighs each average by its own denominator, never averaging the daily averages', () => {
		expect(
			partsToMetrics(week, ['avgDuration', 'bounceRate', 'visitDuration', 'scrollDepth'])
		).toEqual({
			// 6000 ms over 5 pageviews, not the mean of 1000 and 1250.
			avgDuration: 1200,
			// One bounce in four entries.
			bounceRate: 25,
			// 10000 ms over 4 visits.
			visitDuration: 2500,
			// 300 over 4 measured pageviews.
			scrollDepth: 75,
		})
	})

	it('reads counts as they are, a visit being a session', () => {
		expect(
			partsToMetrics(parts({ pageviews: 5, sessions: 4, visitors: 3, events: 0 }), [
				'pageviews',
				'visits',
				'sessions',
				'visitors',
				'events',
			])
		).toEqual({ pageviews: 5, visits: 4, sessions: 4, visitors: 3, events: 0 })
	})

	it('leaves out what the row kind does not count, rather than reading it as zero', () => {
		const item = parts({ impressions: 10, interactions: 2, visitors: 4 })
		expect(
			partsToMetrics(item, ['impressions', 'interactions', 'sessions', 'avgDuration', 'bounceRate'])
		).toEqual({ impressions: 10, interactions: 2 })
	})

	it('reads an average with nothing to average over as no data', () => {
		expect(
			partsToMetrics(parts({ pageviews: 0, durationMs: 0, entries: 0, bounces: 0 }), [
				'avgDuration',
				'bounceRate',
			])
		).toEqual({ avgDuration: null, bounceRate: null })
		expect(partsToMetrics(parts({ pageviews: 3 }), ['avgDuration'])).toEqual({ avgDuration: null })
	})

	it('never reads a scroll depth past the whole page', () => {
		expect(
			partsToMetrics(parts({ scrollSum: 250, scrollSamples: 2 }), ['scrollDepth']).scrollDepth
		).toBe(100)
	})

	it('keeps a negative revenue a refund left', () => {
		expect(partsToMetrics(parts({ revenue: -20 }), ['revenue'])).toEqual({ revenue: -20 })
	})
})
