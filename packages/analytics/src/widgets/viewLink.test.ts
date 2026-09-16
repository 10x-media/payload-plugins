import { describe, expect, it } from 'vitest'
import { type AnalyticsFilter, DIMENSION_KEYS } from '../core/contract'
import { MAX_QUERY_RANGE_DAYS } from '../query/limits'
import { TAB_DIMENSIONS } from '../view/gating'
import { parseViewState, type ViewDefaults } from '../view/state'
import { viewHref, viewTabForDimension } from './viewLink'

const base = {
	adminRoute: '/admin',
	viewPath: '/analytics',
	timezone: 'Europe/Berlin',
	defaultRange: 'last30days',
	defaultMetric: 'pageviews',
} as const

const defaults: ViewDefaults = { range: base.defaultRange, metric: base.defaultMetric }

const query = (href: string): URLSearchParams =>
	new URLSearchParams(href.slice(href.indexOf('?') + 1))

describe('viewHref', () => {
	it('joins the admin route and the view path', () => {
		expect(viewHref({ ...base, timeframe: 'last30days' })).toBe('/admin/analytics')
	})

	it('keeps the view path alone when the admin route is the root', () => {
		expect(viewHref({ ...base, adminRoute: '/', timeframe: 'last7days' })).toBe(
			'/analytics?range=last7days'
		)
	})

	it('maps a widget preset the view offers by name', () => {
		for (const preset of ['today', 'last7days', 'last90days', 'lastYear'] as const) {
			expect(query(viewHref({ ...base, timeframe: preset })).get('range')).toBe(preset)
		}
	})

	it('omits the range when the widget is on the view default', () => {
		expect(query(viewHref({ ...base, timeframe: 'last30days' })).has('range')).toBe(false)
	})

	it('omits exactly what the install configured as its default', () => {
		const configured = { ...base, defaultRange: 'today', defaultMetric: 'visitors' } as const
		expect(query(viewHref({ ...configured, timeframe: 'today' })).has('range')).toBe(false)
		expect(query(viewHref({ ...configured, timeframe: 'last30days' })).get('range')).toBe(
			'last30days'
		)
		expect(
			query(viewHref({ ...configured, timeframe: 'today', metric: 'visitors' })).has('metric')
		).toBe(false)
		expect(
			query(viewHref({ ...configured, timeframe: 'today', metric: 'pageviews' })).get('metric')
		).toBe('pageviews')
	})

	it('opens a configured allTime default on the range the view falls back to', () => {
		const configured = { ...base, defaultRange: 'allTime' } as const
		expect(query(viewHref({ ...configured, timeframe: 'allTime' })).has('range')).toBe(false)
		expect(query(viewHref({ ...configured, timeframe: 'last30days' })).has('range')).toBe(false)
		expect(query(viewHref({ ...configured, timeframe: 'today' })).get('range')).toBe('today')
	})

	it('omits the range for a window the view has no preset for', () => {
		for (const preset of ['allTime', 'thisMonth', 'thisYear'] as const) {
			const params = query(viewHref({ ...base, timeframe: preset }))
			expect(params.has('range')).toBe(false)
			expect(params.has('from')).toBe(false)
			expect(params.has('to')).toBe(false)
		}
	})

	it('spells a custom range as inclusive days in the reporting timezone', () => {
		const params = query(
			viewHref({
				...base,
				timeframe: 'custom',
				range: {
					start: new Date('2026-05-31T22:00:00.000Z'),
					end: new Date('2026-06-22T21:59:59.999Z'),
				},
			})
		)
		expect(params.get('range')).toBe('custom')
		expect(params.get('from')).toBe('2026-06-01')
		expect(params.get('to')).toBe('2026-06-22')
	})

	it('falls back to the view default when a custom timeframe carries no range', () => {
		expect(query(viewHref({ ...base, timeframe: 'custom' })).has('range')).toBe(false)
	})

	it('clamps a custom range wider than the view can hold to its last 366 days', () => {
		const params = query(
			viewHref({
				...base,
				timezone: 'UTC',
				timeframe: 'custom',
				range: {
					start: new Date('2024-01-01T00:00:00.000Z'),
					end: new Date('2026-06-22T23:59:59.999Z'),
				},
			})
		)
		expect(params.get('range')).toBe('custom')
		expect(params.get('to')).toBe('2026-06-22')
		// 366 days counted inclusively, which is exactly what parseViewState accepts.
		expect(params.get('from')).toBe('2025-06-22')
		const from = Date.parse(`${params.get('from')}T00:00:00.000Z`)
		const to = Date.parse(`${params.get('to')}T00:00:00.000Z`)
		expect(Math.round((to - from) / 86_400_000) + 1).toBe(MAX_QUERY_RANGE_DAYS)
	})

	it('leaves a custom range inside the cap alone', () => {
		const params = query(
			viewHref({
				...base,
				timezone: 'UTC',
				timeframe: 'custom',
				range: {
					start: new Date('2026-06-01T00:00:00.000Z'),
					end: new Date('2026-06-22T23:59:59.999Z'),
				},
			})
		)
		expect(params.get('from')).toBe('2026-06-01')
	})

	it('spells the comparison the way the view reads it', () => {
		expect(query(viewHref({ ...base, timeframe: 'today', compare: true })).get('compare')).toBe('1')
		expect(query(viewHref({ ...base, timeframe: 'today', compare: false })).has('compare')).toBe(
			false
		)
	})

	it('carries the metric, dropping the view default', () => {
		expect(query(viewHref({ ...base, timeframe: 'today', metric: 'visitors' })).get('metric')).toBe(
			'visitors'
		)
		expect(
			query(viewHref({ ...base, timeframe: 'today', metric: 'pageviews' })).has('metric')
		).toBe(false)
	})

	it('carries the tab, dropping the view default', () => {
		expect(query(viewHref({ ...base, timeframe: 'today', tab: 'goals' })).get('tab')).toBe('goals')
		expect(query(viewHref({ ...base, timeframe: 'today', tab: 'pages' })).has('tab')).toBe(false)
	})

	it('carries the widget source', () => {
		expect(
			query(viewHref({ ...base, timeframe: 'today', source: 'plausible' })).get('source')
		).toBe('plausible')
		expect(query(viewHref({ ...base, timeframe: 'today' })).has('source')).toBe(false)
	})

	it('writes every key the view parses back into the same state', () => {
		expect(
			viewHref({
				...base,
				timeframe: 'last7days',
				compare: true,
				source: 'plausible',
				metric: 'visitors',
				tab: 'sources',
			})
		).toBe(
			'/admin/analytics?range=last7days&compare=1&source=plausible&metric=visitors&tab=sources'
		)
	})

	it('carries the widget filter into the view state, verbatim', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'country', operator: 'eq', value: 'DE' }]
		const href = viewHref({ ...base, timeframe: 'last7days', filters })
		expect(parseViewState(query(href), defaults).filters).toEqual(filters)
	})

	it('carries a contains filter the same way', () => {
		const filters: AnalyticsFilter[] = [{ dimension: 'page', operator: 'contains', value: '/blog' }]
		const href = viewHref({ ...base, timeframe: 'last30days', filters, tab: 'pages' })
		expect(parseViewState(query(href), defaults).filters).toEqual(filters)
	})

	it('writes no filters param at all when the widget carries none', () => {
		expect(query(viewHref({ ...base, timeframe: 'last7days' })).has('filters')).toBe(false)
		expect(query(viewHref({ ...base, timeframe: 'last7days', filters: [] })).has('filters')).toBe(
			false
		)
	})
})

describe('viewTabForDimension', () => {
	it('answers the tab that offers each contract dimension', () => {
		for (const dimension of DIMENSION_KEYS) {
			const tab = viewTabForDimension(dimension)
			expect(tab).toBeDefined()
			if (tab) {
				expect(TAB_DIMENSIONS[tab]).toContain(dimension)
			}
		}
	})
})
