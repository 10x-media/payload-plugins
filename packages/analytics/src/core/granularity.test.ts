import { describe, expect, it } from 'vitest'
import type { AnalyticsCapabilities, Granularity } from './contract'
import { supportsGranularity } from './granularity'

const caps = (minGranularity: Granularity): AnalyticsCapabilities => ({
	perPageQuery: true,
	realtime: false,
	comparison: false,
	minGranularity,
	maxLookbackDays: null,
	metrics: new Set(),
	dimensions: new Set(),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
})

describe('supportsGranularity', () => {
	it('a day-granularity adapter supports day, week, and month', () => {
		expect(supportsGranularity(caps('day'), 'day')).toBe(true)
		expect(supportsGranularity(caps('day'), 'week')).toBe(true)
		expect(supportsGranularity(caps('day'), 'month')).toBe(true)
	})

	it('a day-granularity adapter cannot bucket finer than a day', () => {
		expect(supportsGranularity(caps('day'), 'hour')).toBe(false)
		expect(supportsGranularity(caps('day'), 'minute')).toBe(false)
	})

	it('an hour-granularity adapter supports day buckets', () => {
		expect(supportsGranularity(caps('hour'), 'day')).toBe(true)
	})
})
