import { describe, expect, it } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import { type SerializedCapabilities, serializeCapabilities } from '../core/capabilities'
import { type AnalyticsCapabilities, DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import { METRIC_KEYS } from '../translations/metricKeys'
import {
	autoGranularity,
	BREAKDOWN_TABS,
	gate,
	ITEM_METRICS,
	resolveSource,
	TAB_DIMENSIONS,
	VIEW_METRIC_ORDER,
} from './gating'

/** The native engine: everything the contract defines, hour buckets included. */
const nativeCaps: SerializedCapabilities = {
	metrics: [...VIEW_METRIC_ORDER],
	dimensions: [...DIMENSION_KEYS],
	filters: Object.fromEntries(
		DIMENSION_KEYS.map((dimension) => [dimension, [...FILTER_OPERATORS]])
	),
	realtime: true,
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
	filters: { page: ['eq', 'contains'], country: ['eq', 'contains'], device: ['eq', 'contains'] },
	realtime: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: 365,
}

/** A day-granular provider with no filters, no comparison and no realtime. */
const narrowCaps: SerializedCapabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page', 'country'],
	filters: {},
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: 90,
}

/** Every adapter the package ships, with placeholder credentials. */
const SHIPPED_ADAPTERS = [
	['plausible', plausible({ siteId: 's', apiKey: 'k' })],
	['ga4', ga4({ propertyId: '1', credentials: { client_email: 'a', private_key: 'b' } })],
	['posthog', posthog({ projectId: '1', apiKey: 'phx_k' })],
	['umami', umami({ websiteId: 'w', apiKey: 'k' })],
] as const

describe('gate', () => {
	it('orders every metric the contract defines', () => {
		expect([...VIEW_METRIC_ORDER].sort()).toEqual(Object.keys(METRIC_KEYS).sort())
	})

	it('offers the Content tab only to a source that lists items', () => {
		expect(gate(posthogCaps).tabs).not.toContain('content')
		expect(gate(nativeCaps).dimensionsFor('content')).toEqual(['item'])
	})

	it("reads an item's views, clicks and conversions as its columns", () => {
		expect(gate(nativeCaps).metricsFor('item', 'pageviews')).toEqual([
			'impressions',
			'interactions',
			'conversions',
		])
	})

	it('files every dimension the contract defines under exactly one tab', () => {
		const filed = BREAKDOWN_TABS.flatMap((tab) => TAB_DIMENSIONS[tab])
		expect([...filed].sort()).toEqual([...DIMENSION_KEYS].sort())
	})

	it('leads each tab with the dimension it opens on', () => {
		// The first served dimension is a tab's default, so this order is what an existing link
		// without a `dim` opens on. Reordering it would silently move everyone's saved views.
		expect(BREAKDOWN_TABS.map((tab) => TAB_DIMENSIONS[tab][0])).toEqual([
			'page',
			'item',
			'channel',
			'device',
			'country',
			'event',
			'goal',
		])
	})

	it('serves every control for the native engine', () => {
		const g = gate(nativeCaps)
		// The item counts are the Content tab's columns, never a card of the whole site, and
		// visits are the one count sessions already show.
		const shown = VIEW_METRIC_ORDER.filter((metric) => metric !== 'visits')
		expect(g.metrics).toEqual(shown.filter((metric) => !ITEM_METRICS.has(metric)))
		expect(g.columns).toEqual(shown)
		expect(g.tabs).toEqual([
			'pages',
			'content',
			'sources',
			'technology',
			'geography',
			'events',
			'goals',
		])
		expect(g.dimensionsFor('sources')).toEqual(TAB_DIMENSIONS.sources)
		expect(g.operatorsFor('page')).toEqual([...FILTER_OPERATORS])
		expect(g.canCompare).toBe(true)
		expect(g.canHour).toBe(true)
		expect(g.realtime).toBe(true)
		expect(g.goals).toBe(true)
	})

	it('offers comparison to a source whose adapter never declared the capability', () => {
		const provider: AnalyticsCapabilities = {
			realtime: false,
			minGranularity: 'day',
			maxLookbackDays: 90,
			metrics: new Set(['pageviews']),
			dimensions: new Set(['page']),
			filters: {},
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
		expect(g.operatorsFor('page')).toEqual(['eq', 'contains'])
		expect(g.operatorsFor('browser')).toEqual([])
		expect(g.canHour).toBe(true)
		expect(g.goals).toBe(true)
	})

	it('drops every tab and control a narrow provider cannot serve', () => {
		const g = gate(narrowCaps)
		expect(g.metrics).toEqual(['pageviews', 'visitors'])
		expect(g.tabs).toEqual(['pages', 'geography'])
		expect(g.dimensionsFor('technology')).toEqual([])
		expect(g.operatorsFor('page')).toEqual([])
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

	// The capability objects the shipped adapters actually declare, not a stand-in: the goals
	// tab appears for every source that can answer it.
	it.each(SHIPPED_ADAPTERS)('opens the goals tab for %s', (_id, adapter) => {
		const g = gate(serializeCapabilities(adapter.capabilities))
		expect(g.goals).toBe(true)
		expect(g.tabs).toContain('goals')
		expect(g.metrics).toContain('conversions')
	})

	// Every provider maps `channel` onto its own acquisition-channel concept, so the sources
	// tab offers it everywhere, PostHog included, where it is the tab's only dimension.
	it.each(SHIPPED_ADAPTERS)('serves channel on the sources tab for %s', (_id, adapter) => {
		const g = gate(serializeCapabilities(adapter.capabilities))
		expect(g.tabs).toContain('sources')
		expect(g.dimensionsFor('sources')).toContain('channel')
	})
})

describe('gate.metricsFor', () => {
	it('reads an event row by its own events and visitors, never by pageviews', () => {
		expect(gate(nativeCaps).metricsFor('event', 'pageviews')).toEqual(['events', 'visitors'])
		// The metric the view is on does not leak in: an event has no pageviews of its own.
		expect(gate(nativeCaps).metricsFor('event', 'bounceRate')).toEqual(['events', 'visitors'])
	})

	it('reads a goal row by conversions and revenue', () => {
		expect(gate(nativeCaps).metricsFor('goal', 'pageviews')).toEqual(['conversions', 'revenue'])
	})

	it('leads every other dimension with the selected metric, then visitors', () => {
		expect(gate(nativeCaps).metricsFor('page', 'pageviews')).toEqual(['pageviews', 'visitors'])
		expect(gate(nativeCaps).metricsFor('country', 'bounceRate')).toEqual(['bounceRate', 'visitors'])
	})

	it('never repeats the selected metric as its own second column', () => {
		expect(gate(nativeCaps).metricsFor('page', 'visitors')).toEqual(['visitors'])
	})

	it('drops a column the source does not serve', () => {
		// PostHog serves no visits and no bounce rate, and Umami-shaped narrowCaps no events.
		expect(gate(posthogCaps).metricsFor('event', 'pageviews')).toEqual(['events', 'visitors'])
		expect(gate(narrowCaps).metricsFor('page', 'visitors')).toEqual(['visitors'])
		expect(gate(narrowCaps).metricsFor('country', 'pageviews')).toEqual(['pageviews', 'visitors'])
	})

	it('falls back rather than asking for a column of zeros', () => {
		const pageviewsOnly: SerializedCapabilities = { ...nativeCaps, metrics: ['pageviews'] }
		// Neither of the event columns is served, so the read asks for what the view is on.
		expect(gate(pageviewsOnly).metricsFor('event', 'pageviews')).toEqual(['pageviews'])
		const visitorsOnly: SerializedCapabilities = { ...nativeCaps, metrics: ['visitors'] }
		// Not even the selected metric: the first metric the source serves at all.
		expect(gate(visitorsOnly).metricsFor('goal', 'pageviews')).toEqual(['visitors'])
	})

	it('answers nothing for a source that serves no metric at all', () => {
		const none: SerializedCapabilities = { ...nativeCaps, metrics: [] }
		expect(gate(none).metricsFor('page', 'pageviews')).toEqual([])
	})

	it('keeps a column out of a breakdown its metric is not read under', () => {
		const g = gate(serializeCapabilities(umami({ websiteId: 'w', apiKey: 'k' }).capabilities))
		// Umami counts visitors per row only: the pageviews column would stay empty.
		expect(g.metricsFor('page', 'pageviews')).toEqual(['visitors'])
		expect(g.metricsFor('country', 'visitDuration')).toEqual(['visitors'])
		expect(g.metricsFor('goal', 'pageviews')).toEqual(['conversions'])
	})
})

describe('one meaning per duration metric', () => {
	const ga4Gate = gate(
		serializeCapabilities(
			ga4({ propertyId: '1', credentials: { client_email: 'a', private_key: 'b' } }).capabilities
		)
	)
	const plausibleGate = gate(
		serializeCapabilities(plausible({ siteId: 's', apiKey: 'k' }).capabilities)
	)
	const umamiGate = gate(serializeCapabilities(umami({ websiteId: 'w', apiKey: 'k' }).capabilities))

	it('offers time on page only on a source with a time per pageview, and time per visit beside it', () => {
		expect(ga4Gate.metrics).toEqual(expect.arrayContaining(['avgDuration', 'visitDuration']))
		expect(plausibleGate.metrics).not.toContain('avgDuration')
		expect(plausibleGate.metrics).toContain('visitDuration')
		expect(umamiGate.metrics).not.toContain('avgDuration')
		expect(umamiGate.metrics).toContain('visitDuration')
	})

	it('leaves a metric needing a page off the whole-site cards', () => {
		expect(plausibleGate.metrics).not.toContain('scrollDepth')
		expect(plausibleGate.metricsFor('page', 'scrollDepth')).toEqual(['scrollDepth', 'visitors'])
	})

	it('keeps time on page off GA4 event rows, which have no views of their own', () => {
		expect(ga4Gate.metricsFor('country', 'avgDuration')).toEqual(['avgDuration', 'visitors'])
		expect(ga4Gate.metricsFor('event', 'avgDuration')).toEqual(['events', 'visitors'])
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
