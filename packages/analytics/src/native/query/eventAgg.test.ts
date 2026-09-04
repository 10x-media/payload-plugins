import { describe, expect, it } from 'vitest'
import type { AnalyticsFilter } from '../../core/contract'
import { aggregateEvents, type EventLike, filtersToWhere } from './eventAgg'

const pageview = (overrides: Partial<EventLike> = {}): EventLike => ({
	timestamp: '2026-01-01T00:00:00.000Z',
	type: 'pageview',
	path: '/a',
	visitorHash: 'v1',
	sessionId: 's1',
	...overrides,
})

describe('filtersToWhere', () => {
	it('maps eq to equals on the mapped field', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'device', operator: 'eq', value: 'mobile' }]
		expect(filtersToWhere(filters)).toEqual({ device: { equals: 'mobile' } })
	})

	it('maps contains to contains', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'page', operator: 'contains', value: '/blog' }]
		expect(filtersToWhere(filters)).toEqual({ path: { contains: '/blog' } })
	})

	it('maps the event dimension to the name field', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'event', operator: 'eq', value: 'signup' }]
		expect(filtersToWhere(filters)).toEqual({ name: { equals: 'signup' } })
	})

	it('drops unsupported operators as the safety net', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'page', operator: 'matches', value: '^/a' }]
		expect(filtersToWhere(filters)).toEqual({})
	})

	it('drops unsupported dimensions as the safety net', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'browser', operator: 'eq', value: 'chrome' }]
		expect(filtersToWhere(filters)).toEqual({})
	})

	it('merges multiple filters into one where fragment', () => {
		const filters: AnalyticsFilter[] = [
			{ dimension: 'device', operator: 'eq', value: 'mobile' },
			{ dimension: 'country', operator: 'eq', value: 'US' },
		]
		expect(filtersToWhere(filters)).toEqual({
			device: { equals: 'mobile' },
			country: { equals: 'US' },
		})
	})

	it('returns an empty fragment for no filters', () => {
		expect(filtersToWhere([])).toEqual({})
	})
})

describe('aggregateEvents totals', () => {
	it('returns zeroed totals for an empty event list', () => {
		const result = aggregateEvents([], { metrics: ['pageviews', 'visitors', 'avgDuration'] })
		expect(result.totals).toEqual({ pageviews: 0, visitors: 0, avgDuration: 0 })
		expect(result.rows).toEqual([{ metrics: { pageviews: 0, visitors: 0, avgDuration: 0 } }])
	})

	it('counts pageviews and custom events separately', () => {
		const events: EventLike[] = [
			pageview(),
			pageview(),
			{ ...pageview(), type: 'event', name: 'signup' },
		]
		const result = aggregateEvents(events, { metrics: ['pageviews', 'events'] })
		expect(result.totals).toEqual({ pageviews: 2, events: 1 })
	})

	it('counts distinct visitors and sessions via Sets', () => {
		const events: EventLike[] = [
			pageview({ visitorHash: 'a', sessionId: 'a-s' }),
			pageview({ visitorHash: 'a', sessionId: 'a-s' }),
			pageview({ visitorHash: 'b', sessionId: 'b-s' }),
		]
		const result = aggregateEvents(events, { metrics: ['visitors', 'sessions'] })
		expect(result.totals).toEqual({ visitors: 2, sessions: 2 })
	})

	it('averages durationMs over all pageviews, treating missing duration as zero', () => {
		const events: EventLike[] = [
			pageview({ durationMs: 1000 }),
			pageview({ durationMs: undefined }),
		]
		const result = aggregateEvents(events, { metrics: ['avgDuration'] })
		expect(result.totals).toEqual({ avgDuration: 500 })
	})
})

describe('aggregateEvents dimension breakdown', () => {
	it('groups by the mapped dimension field', () => {
		const events: EventLike[] = [
			pageview({ device: 'desktop' }),
			pageview({ device: 'desktop' }),
			pageview({ device: 'mobile' }),
		]
		const result = aggregateEvents(events, { metrics: ['pageviews'], dimension: 'device' })
		const byDevice = Object.fromEntries(
			result.rows.map((r) => [r.dimensions?.device, r.metrics.pageviews])
		)
		expect(byDevice).toEqual({ desktop: 2, mobile: 1 })
		expect(result.totals).toEqual({ pageviews: 3 })
	})

	it('groups event-name rows and drops pageviews carrying no name', () => {
		const events: EventLike[] = [
			pageview(),
			{ ...pageview(), type: 'event', name: 'signup' },
			{ ...pageview(), type: 'event', name: 'signup' },
			{ ...pageview(), type: 'event', name: 'login' },
		]
		const result = aggregateEvents(events, { metrics: ['events'], dimension: 'event' })
		const byName = Object.fromEntries(
			result.rows.map((r) => [r.dimensions?.event, r.metrics.events])
		)
		expect(byName).toEqual({ signup: 2, login: 1 })
		expect(result.rows).toHaveLength(2)
	})

	it('sorts breakdown rows by pageviews desc by default', () => {
		const events: EventLike[] = [
			pageview({ device: 'desktop' }),
			pageview({ device: 'tablet' }),
			pageview({ device: 'tablet' }),
			pageview({ device: 'mobile' }),
			pageview({ device: 'mobile' }),
			pageview({ device: 'mobile' }),
		]
		const result = aggregateEvents(events, { metrics: ['pageviews'], dimension: 'device' })
		expect(result.rows.map((r) => r.dimensions?.device)).toEqual(['mobile', 'tablet', 'desktop'])
	})

	it('sorts breakdown rows by a given order metric and direction', () => {
		const events: EventLike[] = [
			pageview({ device: 'desktop', visitorHash: 'a', sessionId: 'a-s' }),
			pageview({ device: 'desktop', visitorHash: 'b', sessionId: 'b-s' }),
			pageview({ device: 'mobile', visitorHash: 'c', sessionId: 'c-s' }),
		]
		const result = aggregateEvents(events, {
			metrics: ['pageviews', 'visitors'],
			dimension: 'device',
			order: { metric: 'visitors', direction: 'asc' },
		})
		expect(result.rows.map((r) => r.dimensions?.device)).toEqual(['mobile', 'desktop'])
	})

	it('limits breakdown rows after sorting', () => {
		const events: EventLike[] = [
			pageview({ device: 'desktop' }),
			pageview({ device: 'tablet' }),
			pageview({ device: 'tablet' }),
			pageview({ device: 'mobile' }),
			pageview({ device: 'mobile' }),
			pageview({ device: 'mobile' }),
		]
		const result = aggregateEvents(events, {
			metrics: ['pageviews'],
			dimension: 'device',
			limit: 2,
		})
		expect(result.rows.map((r) => r.dimensions?.device)).toEqual(['mobile', 'tablet'])
	})
})

describe('aggregateEvents hour/day series', () => {
	it('buckets by UTC hour and emits only active hours', () => {
		const events: EventLike[] = [
			pageview({ timestamp: '2026-01-01T00:10:00.000Z' }),
			pageview({ timestamp: '2026-01-01T00:50:00.000Z' }),
			pageview({ timestamp: '2026-01-01T02:05:00.000Z' }),
		]
		const result = aggregateEvents(events, { metrics: ['pageviews'], granularity: 'hour' })
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 2 } },
			{ timestamp: '2026-01-01T02:00:00.000Z', metrics: { pageviews: 1 } },
		])
		expect(result.totals).toEqual({ pageviews: 3 })
	})

	it('buckets by UTC day when no timezone is given', () => {
		const events: EventLike[] = [
			pageview({ timestamp: '2026-01-01T23:00:00.000Z' }),
			pageview({ timestamp: '2026-01-02T01:00:00.000Z' }),
		]
		const result = aggregateEvents(events, { metrics: ['pageviews'], granularity: 'day' })
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T00:00:00.000Z', metrics: { pageviews: 1 } },
			{ timestamp: '2026-01-02T00:00:00.000Z', metrics: { pageviews: 1 } },
		])
	})

	it('floors day buckets in the given reporting timezone', () => {
		const events: EventLike[] = [pageview({ timestamp: '2026-01-01T23:30:00.000Z' })]
		const result = aggregateEvents(events, {
			metrics: ['pageviews'],
			granularity: 'day',
			timezone: 'America/New_York',
		})
		expect(result.rows).toEqual([
			{ timestamp: '2026-01-01T05:00:00.000Z', metrics: { pageviews: 1 } },
		])
	})

	it('returns no rows for an empty event list with a granularity', () => {
		const result = aggregateEvents([], { metrics: ['pageviews'], granularity: 'hour' })
		expect(result.rows).toEqual([])
		expect(result.totals).toEqual({ pageviews: 0 })
	})
})
