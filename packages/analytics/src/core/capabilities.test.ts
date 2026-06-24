import { describe, expect, it } from 'vitest'
import { satisfiesCapabilities } from './capabilities'
import type { AnalyticsCapabilities } from './contract'

const caps: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors']),
	dimensions: new Set(['page', 'referrer']),
	batchPageReport: true,
	rateLimit: null,
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

describe('satisfiesCapabilities', () => {
	it('passes when all required metrics and dimensions are present', () => {
		expect(satisfiesCapabilities(caps, { metrics: ['pageviews'], dimensions: ['page'] })).toBe(true)
	})
	it('fails on a missing metric', () => {
		expect(satisfiesCapabilities(caps, { metrics: ['scrollDepth'] })).toBe(false)
	})
	it('fails when realtime is required but unsupported', () => {
		expect(satisfiesCapabilities(caps, { realtime: true })).toBe(false)
	})
	it('passes with empty requirements', () => {
		expect(satisfiesCapabilities(caps, {})).toBe(true)
	})
})
