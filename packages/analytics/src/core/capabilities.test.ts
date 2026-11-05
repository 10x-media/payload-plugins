import { describe, expect, it } from 'vitest'
import {
	CAPABILITY_REQUIREMENT_KEYS,
	type CapabilityRequirement,
	comparisonOf,
	filterableDimensions,
	filterOperatorsFor,
	metricOutOfReach,
	metricReaches,
	satisfiesCapabilities,
	serializeCapabilities,
	supportsFilter,
	unsupportedFilter,
} from './capabilities'
import type { AnalyticsCapabilities, AnalyticsFilter } from './contract'

const caps: AnalyticsCapabilities = {
	realtime: false,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
	metrics: new Set(['pageviews', 'visitors']),
	dimensions: new Set(['page', 'referrer', 'country']),
	filters: { page: ['eq', 'contains'], country: ['eq'] },
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
	it('passes a dimension alone when the source filters it with any operator', () => {
		expect(satisfiesCapabilities(caps, { filters: ['page', 'country'] })).toBe(true)
	})
	it('fails a dimension alone the source cannot filter at all', () => {
		expect(satisfiesCapabilities(caps, { filters: ['referrer'] })).toBe(false)
	})
	it('passes a pair the source takes for that dimension', () => {
		expect(
			satisfiesCapabilities(caps, { filters: [{ dimension: 'page', operator: 'contains' }] })
		).toBe(true)
	})
	it('fails a pair whose operator the source takes for another dimension only', () => {
		expect(
			satisfiesCapabilities(caps, { filters: [{ dimension: 'country', operator: 'contains' }] })
		).toBe(false)
	})
	it('fails every filter on a source that declares none', () => {
		const { filters: _filters, ...unfiltered } = caps
		expect(satisfiesCapabilities(unfiltered, { filters: ['page'] })).toBe(false)
	})
})

describe('filter pairs', () => {
	it('lists the operators of one dimension in contract order', () => {
		expect(filterOperatorsFor({ filters: { page: ['contains', 'eq'] } }, 'page')).toEqual([
			'eq',
			'contains',
		])
		expect(filterOperatorsFor(caps, 'referrer')).toEqual([])
		expect(filterOperatorsFor({}, 'page')).toEqual([])
	})

	it('reads a dimension listed with no operator as not filterable', () => {
		expect(filterableDimensions({ filters: { page: [], country: ['eq'] } })).toEqual(['country'])
	})

	it('names the first filter a source cannot apply, the value beside it untouched', () => {
		const filters: AnalyticsFilter[] = [
			{ dimension: 'page', operator: 'eq', value: '/a' },
			{ dimension: 'country', operator: 'matches', value: '^D' },
			{ dimension: 'referrer', operator: 'eq', value: 'x' },
		]
		expect(unsupportedFilter(caps, filters)).toEqual(filters[1])
		expect(unsupportedFilter(caps, filters.slice(0, 1))).toBeUndefined()
		expect(supportsFilter(caps, { dimension: 'page', operator: 'eq' })).toBe(true)
	})
})

/** A provider adapter that never mentions comparison: the engine reads the previous window for it. */
const undeclaredComparison: AnalyticsCapabilities = {
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: 90,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['page']),
	rateLimit: null,
	recommendedTtl: { realtime: 300, aggregate: 3600 },
}

describe('CAPABILITY_REQUIREMENT_KEYS', () => {
	// Typed in full, so a key added to the requirement fails to compile here until it is listed.
	it('lists every key a requirement takes', () => {
		const every: Required<CapabilityRequirement> = {
			metrics: [],
			dimensions: [],
			filters: [],
			realtime: true,
			perItemQuery: true,
			path: true,
		}
		expect([...CAPABILITY_REQUIREMENT_KEYS].sort()).toEqual(Object.keys(every).sort())
	})
})

describe('comparisonOf', () => {
	it('defaults to true when the adapter never declared the capability', () => {
		expect(comparisonOf(undeclaredComparison)).toBe(true)
	})

	it('keeps an explicit true', () => {
		expect(comparisonOf(caps)).toBe(true)
	})

	it('honors an explicit opt-out', () => {
		expect(comparisonOf({ ...caps, comparison: false })).toBe(false)
	})
})

describe('serializeCapabilities', () => {
	it('sends the default to the wire when the adapter omits the key', () => {
		expect(serializeCapabilities(undeclaredComparison).comparison).toBe(true)
	})

	it('turns the metric and dimension sets into arrays and keeps the wire fields', () => {
		const wire = serializeCapabilities({
			...caps,
			realtime: true,
			realtimeWindowMinutes: 60,
			minGranularity: 'day',
			filters: { country: ['eq'], page: ['contains', 'eq'], referrer: [] },
		})
		expect(wire.metrics).toEqual(['pageviews', 'visitors'])
		expect(wire.dimensions).toEqual(['page', 'referrer', 'country'])
		expect(wire.filters).toEqual({ page: ['eq', 'contains'], country: ['eq'] })
		expect(Object.keys(wire.filters)).toEqual(['page', 'country'])
		expect(wire.realtime).toBe(true)
		expect(wire.realtimeWindowMinutes).toBe(60)
		expect(JSON.parse(JSON.stringify(wire))).toEqual(wire)
	})

	it('serializes to exactly the allowlisted keys, dropping adapter-internal fields', () => {
		const wire = serializeCapabilities({
			realtime: false,
			comparison: false,
			minGranularity: 'day',
			maxLookbackDays: 30,
			filterLookbackDays: 7,
			calendarBuckets: true,
			metrics: new Set(),
			dimensions: new Set(),
			semantics: { visitors: 'distinct', sessions: 'provider' },
			rateLimit: { requestsPerHour: 600 },
			recommendedTtl: { realtime: 300, aggregate: 3600 },
			scopedQueries: true,
		})
		expect(Object.keys(wire).sort()).toEqual(
			[
				'comparison',
				'dimensions',
				'filters',
				'maxLookbackDays',
				'metrics',
				'minGranularity',
				'realtime',
			].sort()
		)
		expect(wire.metrics).toEqual([])
		expect(wire.filters).toEqual({})
		expect((wire as Record<string, unknown>).rateLimit).toBeUndefined()
		expect((wire as Record<string, unknown>).recommendedTtl).toBeUndefined()
		expect((wire as Record<string, unknown>).scopedQueries).toBeUndefined()
	})

	it('omits realtimeWindowMinutes from the wire object when unset', () => {
		expect('realtimeWindowMinutes' in serializeCapabilities(undeclaredComparison)).toBe(false)
	})

	it('carries perItemQuery only for a source that reads items, so older wire shapes stay as they were', () => {
		expect('perItemQuery' in serializeCapabilities(undeclaredComparison)).toBe(false)
		expect(
			serializeCapabilities({ ...undeclaredComparison, perItemQuery: true }).perItemQuery
		).toBe(true)
		expect(satisfiesCapabilities(undeclaredComparison, { perItemQuery: true })).toBe(false)
		expect(
			satisfiesCapabilities({ ...undeclaredComparison, perItemQuery: true }, { perItemQuery: true })
		).toBe(true)
	})
})

describe('metric reach', () => {
	const reached: AnalyticsCapabilities = {
		...caps,
		metrics: new Set(['pageviews', 'visitors', 'avgDuration', 'scrollDepth']),
		dimensions: new Set(['page', 'country', 'event']),
		metricReach: {
			avgDuration: { dimensions: ['page', 'country'] },
			scrollDepth: { requires: 'page' },
		},
	}

	it('reads a metric absent from metricReach under every dimension', () => {
		expect(metricReaches(reached, 'pageviews', { dimensions: ['event'] })).toBe(true)
	})

	it('names the breakdown a metric is not read under', () => {
		expect(metricOutOfReach(reached, 'avgDuration', { dimensions: ['event'] })).toEqual({
			breakdown: 'event',
		})
		expect(metricOutOfReach(reached, 'avgDuration', { dimensions: ['country'] })).toBeNull()
		expect(metricOutOfReach(reached, 'avgDuration', {})).toBeNull()
	})

	it('reads a metric needing a page only by page, filtered by it, or for one page', () => {
		expect(metricOutOfReach(reached, 'scrollDepth', {})).toEqual({ needs: 'page' })
		expect(metricReaches(reached, 'scrollDepth', { dimensions: ['page'] })).toBe(true)
		expect(metricReaches(reached, 'scrollDepth', { filters: ['page'] })).toBe(true)
		expect(
			metricReaches(reached, 'scrollDepth', {
				dimensions: ['country'],
				filters: [{ dimension: 'page', operator: 'eq' }],
			})
		).toBe(true)
		expect(metricReaches(reached, 'scrollDepth', { path: true })).toBe(true)
	})

	it('folds reach into satisfiesCapabilities, a requirement saying it reads one page', () => {
		expect(
			satisfiesCapabilities(reached, { metrics: ['avgDuration'], dimensions: ['event'] })
		).toBe(false)
		expect(satisfiesCapabilities(reached, { metrics: ['scrollDepth'] })).toBe(false)
		expect(satisfiesCapabilities(reached, { metrics: ['scrollDepth'], path: true })).toBe(true)
	})

	it('serializes the reach of declared metrics only, and nothing for a source declaring none', () => {
		const wire = serializeCapabilities({
			...reached,
			metricReach: { ...reached.metricReach, revenue: { dimensions: [] } },
		})
		expect(wire.metricReach).toEqual({
			avgDuration: { dimensions: ['page', 'country'] },
			scrollDepth: { requires: 'page' },
		})
		expect(metricReaches(wire, 'avgDuration', { dimensions: ['event'] })).toBe(false)
		expect('metricReach' in serializeCapabilities(caps)).toBe(false)
	})
})
