import { describe, expect, it } from 'vitest'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import { type AnalyticsCapabilities, DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import { METRIC_KEYS } from '../translations/metricKeys'
import {
	autoGranularity,
	BREAKDOWN_TABS,
	gate,
	resolveSource,
	TAB_DIMENSIONS,
	VIEW_METRIC_ORDER,
} from './gating'

/** The native engine: everything the contract defines, hour buckets included. */
const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: [...DIMENSION_KEYS],
	filterOperators: [...FILTER_OPERATORS],
	realtime: true,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
}

/** A provider with comparison, hour buckets and filters on a subset of dimensions. */
const posthogCaps: SerializedCapabilities = {
	metrics: ['visitors', 'pageviews', 'sessions', 'events', 'conversions', 'revenue'],
	dimensions: [
		'page',
		'referrer',
		'utmSource',
		'utmMedium',
		'utmCampaign',
		'device',
		'browser',
		'os',
		'country',
		'event',
		'goal',
	],
	filters: ['page', 'country', 'device'],
	filterOperators: ['eq', 'contains'],
	realtime: true,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: 365,
}

/** A day-granular provider with no filters, no comparison and no realtime. */
const narrowCaps: SerializedCapabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page', 'country'],
	filters: [],
	filterOperators: [],
	realtime: false,
	perPageQuery: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: 90,
}

describe('gate', () => {
	it('orders every metric the contract defines', () => {
		expect([...VIEW_METRIC_ORDER].sort()).toEqual(Object.keys(METRIC_KEYS).sort())
	})

	it('files every dimension the contract defines under exactly one tab', () => {
		const filed = BREAKDOWN_TABS.flatMap((tab) => TAB_DIMENSIONS[tab])
		expect([...filed].sort()).toEqual([...DIMENSION_KEYS].sort())
	})

	it('leads each tab with the dimension that tab read before the group-by picker', () => {
		// The first served dimension is a tab's default, so this order is what an existing link
		// without a `dim` opens on. Reordering it would silently move everyone's saved views.
		expect(BREAKDOWN_TABS.map((tab) => TAB_DIMENSIONS[tab][0])).toEqual([
			'page',
			'source',
			'device',
			'country',
			'event',
			'goal',
		])
	})

	it('serves every control for the native engine', () => {
		const g = gate(nativeCaps)
		expect(g.metrics).toEqual(VIEW_METRIC_ORDER)
		expect(g.tabs).toEqual(['pages', 'sources', 'technology', 'geography', 'events', 'goals'])
		expect(g.dimensionsFor('sources')).toEqual(TAB_DIMENSIONS.sources)
		expect(g.canFilter('page')).toBe(true)
		expect(g.operators).toEqual([...FILTER_OPERATORS])
		expect(g.canCompare).toBe(true)
		expect(g.canHour).toBe(true)
		expect(g.realtime).toBe(true)
		expect(g.goals).toBe(true)
	})

	it('offers comparison to a source whose adapter never declared the capability', () => {
		const provider: AnalyticsCapabilities = {
			perPageQuery: false,
			realtime: false,
			minGranularity: 'day',
			maxLookbackDays: 90,
			metrics: new Set(['pageviews']),
			dimensions: new Set(['page']),
			filters: new Set(),
			filterOperators: new Set(),
			batchPageReport: false,
			rateLimit: null,
			recommendedTtl: { realtime: 300, aggregate: 3600 },
		}
		expect(gate(serializeCapabilities(provider)).canCompare).toBe(true)
	})

	it('orders metrics canonically regardless of the capability order', () => {
		expect(gate(posthogCaps).metrics).toEqual([
			'pageviews',
			'visitors',
			'sessions',
			'events',
			'conversions',
			'revenue',
		])
	})

	it('keeps only the dimensions a provider serves, in the tab order', () => {
		const g = gate(posthogCaps)
		expect(g.tabs).toEqual(['pages', 'sources', 'technology', 'geography', 'events', 'goals'])
		expect(g.dimensionsFor('sources')).toEqual([
			'referrer',
			'utmSource',
			'utmMedium',
			'utmCampaign',
		])
		expect(g.dimensionsFor('geography')).toEqual(['country'])
		expect(g.canFilter('page')).toBe(true)
		expect(g.canFilter('browser')).toBe(false)
		expect(g.operators).toEqual(['eq', 'contains'])
		expect(g.canHour).toBe(true)
		expect(g.goals).toBe(true)
	})

	it('drops every tab and control a narrow provider cannot serve', () => {
		const g = gate(narrowCaps)
		expect(g.metrics).toEqual(['pageviews', 'visitors'])
		expect(g.tabs).toEqual(['pages', 'geography'])
		expect(g.dimensionsFor('technology')).toEqual([])
		expect(g.canFilter('page')).toBe(false)
		expect(g.operators).toEqual([])
		expect(g.canCompare).toBe(false)
		expect(g.canHour).toBe(false)
		expect(g.realtime).toBe(false)
		expect(g.goals).toBe(false)
		expect(g.granularities).toEqual(['day', 'week', 'month'])
	})

	it('never offers minute buckets, whatever the source could serve', () => {
		const minuteCaps: SerializedCapabilities = { ...nativeCaps, minGranularity: 'minute' }
		expect(gate(minuteCaps).granularities).toEqual(['hour', 'day', 'week', 'month'])
		expect(gate(minuteCaps).canHour).toBe(true)
	})

	it('reports the lookback the source allows, so the toolbar can hide longer ranges', () => {
		expect(gate(narrowCaps).maxRangeDays).toBe(90)
		expect(gate(posthogCaps).maxRangeDays).toBe(365)
		expect(gate(nativeCaps).maxRangeDays).toBeNull()
	})

	it('needs both conversions and the goal dimension for the goals panel', () => {
		expect(gate({ ...nativeCaps, metrics: ['pageviews'] }).goals).toBe(false)
		expect(gate({ ...nativeCaps, dimensions: ['page'] }).goals).toBe(false)
	})
})

describe('autoGranularity', () => {
	const range = (from: string, to: string) => ({ from, to })

	it('buckets by hour for a window of at most two days when the source can', () => {
		expect(autoGranularity(range('2026-03-01', '2026-03-01'), nativeCaps)).toBe('hour')
		expect(autoGranularity(range('2026-03-01', '2026-03-02'), posthogCaps)).toBe('hour')
		expect(autoGranularity(range('2026-03-01', '2026-03-03'), nativeCaps)).toBe('day')
	})

	it('buckets by day when the source cannot bucket by hour', () => {
		expect(autoGranularity(range('2026-03-01', '2026-03-01'), narrowCaps)).toBe('day')
	})

	it('buckets by week beyond 120 days', () => {
		expect(autoGranularity(range('2025-11-01', '2026-03-01'), nativeCaps)).toBe('week')
		expect(autoGranularity(range('2025-11-02', '2026-03-01'), nativeCaps)).toBe('day')
	})

	it('never asks for a bucket finer than the source serves', () => {
		const monthly: SerializedCapabilities = { ...narrowCaps, minGranularity: 'month' }
		expect(autoGranularity(range('2026-03-01', '2026-03-01'), monthly)).toBe('month')
		expect(autoGranularity(range('2025-01-01', '2026-03-01'), monthly)).toBe('month')
	})
})

describe('resolveSource', () => {
	const sources = {
		defaultId: 'native',
		sources: [
			{ id: 'native', label: 'Native', kind: 'config' as const, capabilities: nativeCaps },
			{ id: 'posthog', label: 'PostHog', kind: 'config' as const, capabilities: posthogCaps },
		],
	}

	it('answers the selected source, then the default, then null', () => {
		expect(resolveSource(sources, 'posthog')?.id).toBe('posthog')
		expect(resolveSource(sources)?.id).toBe('native')
		expect(resolveSource(sources, 'gone')?.id).toBe('native')
		expect(resolveSource({ defaultId: null, sources: [] })).toBeNull()
		expect(resolveSource({ defaultId: 'gone', sources: [] })).toBeNull()
	})
})
