import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsCapabilities,
	AnalyticsQuery,
	AnalyticsResult,
	DimensionKey,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { resolveTimeframe } from '../timeframe/presets'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import AnalyticsTrendWidget from './AnalyticsTrendWidget'
import { previousWindow } from './comparison'
import { formatRangeCaption } from './range'
import type { MetricWidgetData } from './types'
import type { WidgetView } from './viewLink'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(),
	filters: new Set(),
	filterOperators: new Set(['eq']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 300 },
}

const adapter: AnalyticsAdapter = {
	id: 'native',
	label: 'Native',
	capabilities,
	isConfigured: () => true,
	async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		return {
			rows: [{ timestamp: q.dateRange.start.toISOString(), metrics: { pageviews: 4 } }],
			totals: { pageviews: 4 },
			meta: { provider: 'native', fetchedAt: NOW.toISOString() },
		}
	},
}

const req = (): PayloadRequest => {
	const payload = {
		config: { routes: { admin: '/admin' } },
	} as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set(['native']),
		bindings: {},
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload, i18n: { t: (key: string) => key, language: 'en' } } as unknown as PayloadRequest
}

const renderWidget = async (widgetData: MetricWidgetData, view?: WidgetView): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsTrendWidget({ req: req(), widgetData, view } as unknown as WidgetServerProps)
	)

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

describe('AnalyticsTrendWidget comparison', () => {
	// The chart injects its stylesheet inline, so every class name appears in the markup
	// either way; assertions match the rendered element instead.
	it('overlays the previous period when compare is on', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days', compare: true })
		expect(html).toContain('<div class="analytics-chart__legend">')
		expect(html).toContain('analytics:viewTrendPrevious')
	})

	it('names the previous range beside the legend label', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days', compare: true })
		const range = previousWindow(resolveTimeframe('last7days', new Date(), 'UTC'), 'UTC')
		expect(range).not.toBeNull()
		if (!range) {
			return
		}
		expect(html).toContain(
			`<span class="analytics-chart__legend-range">· ${formatRangeCaption(range, 'en', 'UTC')}</span>`
		)
	})

	it('draws one series when compare is off', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		expect(html).not.toContain('<div class="analytics-chart__legend">')
		// The period-over-period delta is independent of the overlay.
		expect(html).toContain('analytics:comparisonVsPrevious')
	})
})

describe('AnalyticsTrendWidget view link', () => {
	const view = {
		path: '/analytics',
		defaultRange: 'last30days',
		defaultMetric: 'pageviews',
	} as const

	it('carries its window, comparison and the adapter that served it into the view', async () => {
		const html = await renderWidget(
			{ metric: 'pageviews', timeframe: 'last7days', compare: true },
			view
		)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe('/admin/analytics?range=last7days&compare=1&source=native')
	})

	it('omits a range the install already defaults to', async () => {
		const html = await renderWidget(
			{ metric: 'pageviews', timeframe: 'last7days' },
			{
				...view,
				defaultRange: 'last7days',
			}
		)
		expect(hrefIn(html)).toBe('/admin/analytics?source=native')
	})

	it('renders no link when the app turned the view off', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' }, false)
		expect(html).not.toContain('analytics-widget__link')
	})
})

/** The two caption templates, which carry the `{{vars}}` the assertions read. */
const TEMPLATES: Record<string, string> = {
	[keys.widgetFilterCaption]: en[keys.widgetFilterCaption],
	[keys.widgetCaptionWithFilter]: en[keys.widgetCaptionWithFilter],
}

/**
 * Every key stands in for itself, except the caption templates, which come from the real
 * bundle so the assertion sees the same one-pass `{{vars}}` fill Payload's own `t` makes.
 */
const fakeT = (key: string, vars?: Record<string, string | number>): string =>
	(TEMPLATES[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) => {
		const value = vars?.[name.trim()]
		return value === undefined ? match : String(value)
	})

const filterableReq = (filters: DimensionKey[]): PayloadRequest => {
	const filtering: AnalyticsAdapter = {
		...adapter,
		capabilities: { ...capabilities, filters: new Set(filters) },
	}
	const payload = {
		config: { routes: { admin: '/admin' } },
	} as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([filtering]),
		configAdapterIds: new Set(['native']),
		bindings: {},
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
	})
	return { payload, i18n: { t: fakeT, language: 'en' } } as unknown as PayloadRequest
}

const renderFiltered = async (
	filters: DimensionKey[],
	widgetData: MetricWidgetData,
	view?: WidgetView
): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsTrendWidget({
			req: filterableReq(filters),
			widgetData,
			view,
		} as unknown as WidgetServerProps)
	)

describe('AnalyticsTrendWidget filter', () => {
	const view = {
		path: '/analytics',
		defaultRange: 'last30days',
		defaultMetric: 'pageviews',
	} as const

	it('appends the filter sentence to the caption', async () => {
		const html = await renderFiltered(['page'], {
			metric: 'pageviews',
			timeframe: 'last7days',
			filter: { dimension: 'page', operator: 'eq', value: '/blog' },
		})
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionPage analytics:filterOperatorEq /blog'
		)
	})

	it('says the source cannot apply the filter instead of charting an unfiltered series', async () => {
		const html = await renderFiltered(
			[],
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'page', operator: 'eq', value: '/blog' },
			},
			view
		)
		expect(html).toContain('analytics:stateFilterUnsupported')
		expect(html).not.toContain('analytics-chart')
	})

	it('holds the caption back when there is no series to caption', async () => {
		const html = await renderFiltered(
			[],
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'page', operator: 'eq', value: '/blog' },
			},
			view
		)
		expect(html).not.toContain('analytics:timeframeLast7Days')
		expect(html).not.toContain('analytics:viewDimensionPage')
	})

	it('carries the filter into the view link, even where the source cannot apply it', async () => {
		for (const filters of [['page'] as DimensionKey[], [] as DimensionKey[]]) {
			const html = await renderFiltered(
				filters,
				{
					metric: 'pageviews',
					timeframe: 'last7days',
					filter: { dimension: 'page', operator: 'eq', value: '/blog' },
				},
				view
			)
			const carried = new URLSearchParams(hrefIn(html)?.split('?')[1] ?? '').get('filters')
			expect(carried && JSON.parse(carried)).toEqual([
				{ dimension: 'page', operator: 'eq', value: '/blog' },
			])
		}
	})
})

describe('AnalyticsTrendWidget state notices', () => {
	const renderWith = async (meta: Partial<AnalyticsResult['meta']>): Promise<string> => {
		const degraded: AnalyticsAdapter = {
			...adapter,
			async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
				return {
					rows: [{ timestamp: q.dateRange.start.toISOString(), metrics: { pageviews: 4 } }],
					totals: { pageviews: 4 },
					meta: { provider: 'native', fetchedAt: NOW.toISOString(), ...meta },
				}
			},
		}
		const payload = {
			config: { routes: { admin: '/admin' } },
		} as unknown as PayloadRequest['payload']
		setRuntime(payload, {
			registry: createRegistry([degraded]),
			configAdapterIds: new Set(['native']),
			bindings: {},
			engine: { read: async (a, query) => a.query(query, {}) },
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: false,
		})
		return renderToStaticMarkup(
			await AnalyticsTrendWidget({
				req: { payload, i18n: { t: (key: string) => key, language: 'en' } },
				widgetData: { metric: 'pageviews', timeframe: 'last7days' },
			} as unknown as WidgetServerProps)
		)
	}

	it('says a series came from an expired cache rather than drawing it silently', async () => {
		expect(await renderWith({ stale: true })).toContain(keys.viewStale)
	})

	it('says nothing about caching on a fresh series', async () => {
		expect(await renderWith({})).not.toContain(keys.viewStale)
	})
})
