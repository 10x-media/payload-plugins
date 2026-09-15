import { describe, expect, it } from 'vitest'
import { DIMENSION_KEYS } from '../core/contract'
import { BREAKDOWN_SPECS } from './breakdownTypes'

describe('BREAKDOWN_SPECS', () => {
	// 5 pre-existing (pages, sources, devices, countries, goals) + 5 new (referrers,
	// browsers, os, campaigns, events); the spec's decision 3 enumerates both groups.
	it('has ten entries', () => {
		expect(BREAKDOWN_SPECS).toHaveLength(10)
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

	it('sets preferredDefault only on the goals and events specs', () => {
		const withDefault = BREAKDOWN_SPECS.filter((s) => s.preferredDefault)
			.map((s) => s.slug)
			.sort()
		expect(withDefault).toEqual(['analytics-breakdown-events', 'analytics-breakdown-goals'])
	})
})
