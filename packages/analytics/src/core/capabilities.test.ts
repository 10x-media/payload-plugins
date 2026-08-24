import { describe, expect, it } from 'vitest'
import { satisfiesCapabilities, serializeCapabilities } from './capabilities'
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

describe('serializeCapabilities', () => {
	it('turns the metric and dimension sets into arrays and keeps everything else', () => {
		const caps: AnalyticsCapabilities = {
			perPageQuery: true,
			realtime: true,
			realtimeWindowMinutes: 60,
			comparison: true,
			minGranularity: 'day',
			maxLookbackDays: null,
			metrics: new Set(['pageviews', 'visitors']),
			dimensions: new Set(['page']),
			batchPageReport: true,
			rateLimit: null,
			recommendedTtl: { realtime: 10, aggregate: 300 },
		}
		const wire = serializeCapabilities(caps)
		expect(wire.metrics).toEqual(['pageviews', 'visitors'])
		expect(wire.dimensions).toEqual(['page'])
		expect(wire.realtime).toBe(true)
		expect(wire.recommendedTtl).toEqual({ realtime: 10, aggregate: 300 })
		expect(JSON.parse(JSON.stringify(wire))).toEqual(wire)
	})

	it('carries optional flags through', () => {
		const caps: AnalyticsCapabilities = {
			perPageQuery: false,
			realtime: false,
			comparison: false,
			minGranularity: 'day',
			maxLookbackDays: 30,
			metrics: new Set(),
			dimensions: new Set(),
			batchPageReport: false,
			rateLimit: { requestsPerHour: 600 },
			recommendedTtl: { realtime: 300, aggregate: 3600 },
			scopedQueries: true,
		}
		expect(serializeCapabilities(caps).scopedQueries).toBe(true)
		expect(serializeCapabilities(caps).metrics).toEqual([])
	})
})
