import { describe, expect, it } from 'vitest'
import type { AnalyticsCapabilities, AnalyticsQuery, DimensionKey } from '../core/contract'
import {
	calendarDays,
	declaredFilters,
	everyOperatorOn,
	firstMapped,
	mappedKeys,
	providerMetricKeys,
	readableMetrics,
} from './mapping'

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T23:59:59Z') },
	...over,
})

const FIELDS: Partial<Record<DimensionKey, string>> = { page: 'path', country: 'country' }

describe('mappedKeys', () => {
	it('keeps the keys the map names, in the order of the full list', () => {
		expect([...mappedKeys(['page', 'referrer', 'country'], { country: 'c', page: 'p' })]).toEqual([
			'page',
			'country',
		])
	})
})

describe('everyOperatorOn', () => {
	it('offers every operator on each dimension and leaves goal out', () => {
		expect(everyOperatorOn(['page', 'goal'])).toEqual({ page: ['eq', 'contains', 'matches'] })
	})
})

describe('firstMapped', () => {
	it('is the first dimension the map names, with its field', () => {
		expect(firstMapped(['source', 'country', 'page'], FIELDS)).toEqual({
			dimension: 'country',
			field: 'country',
		})
		expect(firstMapped(['source'], FIELDS)).toBeUndefined()
		expect(firstMapped(undefined, FIELDS)).toBeUndefined()
	})
})

describe('declaredFilters', () => {
	it('pairs each declared filter with its field and drops the rest', () => {
		const caps = { filters: { page: ['eq'] as const, source: ['eq'] as const } }
		expect(
			declaredFilters(
				caps,
				[
					{ dimension: 'page', operator: 'eq', value: '/a' },
					{ dimension: 'page', operator: 'contains', value: '/b' },
					{ dimension: 'source', operator: 'eq', value: 'x' },
				],
				FIELDS
			)
		).toEqual([{ filter: { dimension: 'page', operator: 'eq', value: '/a' }, field: 'path' }])
		expect(declaredFilters(caps, undefined, FIELDS)).toEqual([])
	})
})

describe('readableMetrics', () => {
	const caps: AnalyticsCapabilities = {
		realtime: false,
		minGranularity: 'day',
		maxLookbackDays: null,
		metrics: new Set(['pageviews', 'scrollDepth']),
		dimensions: new Set(['page', 'country']),
		metricReach: { scrollDepth: { requires: 'page' } },
		semantics: { visitors: 'distinct', sessions: 'provider' },
		rateLimit: null,
		recommendedTtl: { realtime: 60, aggregate: 60 },
	}

	it('keeps the declared metrics the read reaches', () => {
		const metrics = ['pageviews', 'scrollDepth', 'visitors'] as const
		expect(readableMetrics(caps, q({ metrics: [...metrics] }), [])).toEqual(['pageviews'])
		expect(readableMetrics(caps, q({ metrics: [...metrics], path: '/a' }), [])).toEqual([
			'pageviews',
			'scrollDepth',
		])
		expect(readableMetrics(caps, q({ metrics: [...metrics] }), ['page'])).toEqual([
			'pageviews',
			'scrollDepth',
		])
	})
})

describe('providerMetricKeys', () => {
	it('dedupes contract metrics that alias one provider metric', () => {
		expect(
			providerMetricKeys(['visits', 'sessions', 'pageviews'], {
				visits: 'visits',
				sessions: 'visits',
				pageviews: 'pageviews',
			})
		).toEqual(['visits', 'pageviews'])
	})

	it('reads a metric drawn from several provider metrics from each, once', () => {
		expect(
			providerMetricKeys(['avgDuration', 'pageviews'], {
				avgDuration: ['engaged', 'views'],
				pageviews: 'views',
			})
		).toEqual(['engaged', 'views'])
	})
})

describe('calendarDays', () => {
	it('names both bounds as days in the reporting zone, UTC without one', () => {
		expect(calendarDays(q())).toEqual(['2026-01-01', '2026-01-31'])
		expect(
			calendarDays(
				q({
					timezone: 'Europe/Berlin',
					dateRange: {
						start: new Date('2026-08-31T22:00:00.000Z'),
						end: new Date('2026-09-07T21:59:59.999Z'),
					},
				})
			)
		).toEqual(['2026-09-01', '2026-09-07'])
	})
})
