import type { PayloadRequest, WidgetServerProps } from 'payload'
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
import { renderSettled } from '../testing/renderSettled'
import { previousWindow } from '../timeframe/comparison'
import { resolveTimeframe } from '../timeframe/presets'
import { keys } from '../translations/keys'
import AnalyticsTrendWidget from './AnalyticsTrendWidget'
import { formatRangeCaption } from './range'
import type { MetricWidgetData } from './types'
import type { WidgetView } from './viewLink'
import { captionT, hrefIn, TEST_VIEW as view } from './widgetTestKit'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const capabilities: AnalyticsCapabilities = {
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(),
	filters: {},
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
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
	})
	return { payload, i18n: { t: (key: string) => key, language: 'en' } } as unknown as PayloadRequest
}

const renderWidget = async (widgetData: MetricWidgetData, view?: WidgetView): Promise<string> =>
	renderSettled(
		AnalyticsTrendWidget({ req: req(), widgetData, view } as unknown as WidgetServerProps)
	)

describe('AnalyticsTrendWidget comparison', () => {
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

	// A preset window runs up to now, so today is still being counted: dashed, and said so.
	it('marks the day still counting, and says "so far" where it names it', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		expect(html).toContain('analytics-chart__line analytics-chart__line--partial')
		expect(html.split('analytics:chartSoFar').length - 1).toBe(1)
	})

	it('draws one series when compare is off', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		expect(html).not.toContain('<div class="analytics-chart__legend">')
		// The period-over-period delta is independent of the overlay.
		expect(html).toContain('analytics:comparisonVsPrevious')
	})
})

describe('AnalyticsTrendWidget card', () => {
	it('charts in the body, following the height the card has left', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		const body = html.slice(html.indexOf('class="analytics-widget__body"'))
		expect(body).toContain('class="analytics-chart analytics-chart--trend analytics-chart--fill"')
		expect(html.indexOf('analytics-widget__value-row')).toBeLessThan(
			html.indexOf('analytics-widget__body')
		)
	})

	it('puts the delta beside the headline number and the window in the header', async () => {
		const html = await renderWidget({ metric: 'pageviews', timeframe: 'last7days' })
		const row = html.slice(
			html.indexOf('analytics-widget__value-row'),
			html.indexOf('analytics-widget__body')
		)
		expect(row).toContain('analytics-delta__caption">analytics:comparisonVsPrevious<')
		const header = /<div class="analytics-widget__header"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? ''
		expect(header).toContain('analytics:timeframeLast7Days')
	})
})

describe('AnalyticsTrendWidget view link', () => {
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

const filterableReq = (filters: DimensionKey[]): PayloadRequest => {
	const filtering: AnalyticsAdapter = {
		...adapter,
		capabilities: {
			...capabilities,
			filters: Object.fromEntries(filters.map((dimension) => [dimension, ['eq'] as const])),
		},
	}
	const payload = {
		config: { routes: { admin: '/admin' } },
	} as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([filtering]),
		configAdapterIds: new Set(['native']),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
	})
	return { payload, i18n: { t: captionT, language: 'en' } } as unknown as PayloadRequest
}

const renderFiltered = async (
	filters: DimensionKey[],
	widgetData: MetricWidgetData,
	view?: WidgetView
): Promise<string> =>
	renderSettled(
		AnalyticsTrendWidget({
			req: filterableReq(filters),
			widgetData,
			view,
		} as unknown as WidgetServerProps)
	)

describe('AnalyticsTrendWidget filter', () => {
	it('appends the filter sentence to the caption', async () => {
		const html = await renderFiltered(['page'], {
			metric: 'pageviews',
			timeframe: 'last7days',
			filter: { dimension: 'page', operator: 'eq', value: '/blog' },
		})
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionPage analytics:filterOperatorEq \u2068/blog\u2069'
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
			readAccess: () => true,
			engine: { read: async (a, query) => a.query(query, {}) },
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: false,
		})
		return renderSettled(
			AnalyticsTrendWidget({
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

	it('says a series stands on goals the source could not read', async () => {
		expect(await renderWith({ goalsUnresolved: true })).toContain(keys.stateGoalsUnresolved)
		expect(await renderWith({})).not.toContain(keys.stateGoalsUnresolved)
	})
})

describe('AnalyticsTrendWidget custom range', () => {
	it('says a range before 1970 is invalid instead of charting the last 30 days', async () => {
		const html = await renderWidget({
			metric: 'pageviews',
			timeframe: 'custom',
			range: { from: '1969-12-01', to: '1970-01-05' },
		})
		expect(html).toContain(keys.viewErrorInvalid)
		expect(html).not.toContain('<svg')
	})
})
