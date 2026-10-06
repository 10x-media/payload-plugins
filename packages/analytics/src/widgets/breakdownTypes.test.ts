import { describe, expect, it } from 'vitest'
import { DIMENSION_KEYS } from '../core/contract'
import { BREAKDOWN_SPECS } from './breakdownTypes'

describe('BREAKDOWN_SPECS', () => {
	// 5 pre-existing (pages, sources, devices, countries, goals) + 5 from the spec's decision 3
	// (referrers, browsers, os, campaigns, events) + channels.
	it('has eleven entries', () => {
		expect(BREAKDOWN_SPECS).toHaveLength(11)
	})

	it('has unique slugs', () => {
		const slugs = BREAKDOWN_SPECS.map((s) => s.slug)
		expect(new Set(slugs).size).toBe(slugs.length)
	})

	it('has unique dimensions', () => {
		const dimensions = BREAKDOWN_SPECS.map((s) => s.dimension)
		expect(new Set(dimensions).size).toBe(dimensions.length)
	})

	it('uses only known dimension keys', () => {
		for (const spec of BREAKDOWN_SPECS) {
			expect(DIMENSION_KEYS).toContain(spec.dimension)
		}
	})

	it('sets preferredDefault only where pageviews is the wrong question', () => {
		const withDefault = BREAKDOWN_SPECS.filter((s) => s.preferredDefault)
			.map((s) => s.slug)
			.sort()
		expect(withDefault).toEqual([
			'analytics-breakdown-channels',
			'analytics-breakdown-events',
			'analytics-breakdown-goals',
		])
	})

	it('opens the channels card on visitors', () => {
		const channels = BREAKDOWN_SPECS.find((s) => s.slug === 'analytics-breakdown-channels')
		expect(channels?.dimension).toBe('channel')
		expect(channels?.preferredDefault).toBe('visitors')
	})
})
