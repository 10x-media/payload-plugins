import type { Payload, PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import AnalyticsMetricWidget from './AnalyticsMetricWidget'
import type { MetricWidgetData } from './types'
import type { WidgetView } from './viewLink'

const unconfigured = {
	id: 'test',
	label: 'Test',
	capabilities: { metrics: new Set(['pageviews']) },
	isConfigured: () => false,
} as unknown as AnalyticsAdapter

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

const bootFakeRuntime = (adapter: AnalyticsAdapter = unconfigured) => {
	const resolveScope = vi.fn(() => Promise.resolve(null))
	const resolveTimezone = vi.fn(() => Promise.resolve('Europe/Berlin'))
	const payload = {
		logger: { warn: () => {} },
		config: { routes: { admin: '/admin' } },
	} as unknown as Payload
	setRuntime(payload, {
		registry: { default: () => adapter, get: () => adapter },
		configAdapterIds: new Set<string>(),
		bindings: {},
		engine: { read: (a: AnalyticsAdapter, query: unknown) => a.query(query as never, {}) },
		ttl: {},
		comparison: false,
		resolveScope,
		resolveTimezone,
	} as unknown as AnalyticsRuntime)
	const req = {
		payload,
		i18n: { t: fakeT, language: 'en' },
	} as unknown as PayloadRequest
	return { req, resolveScope, resolveTimezone }
}

/** A source that serves pageviews and can filter exactly what `filters` names. */
const filterableAdapter = (filters: string[], operators: string[] = ['eq']): AnalyticsAdapter =>
	({
		id: 'test',
		label: 'Test',
		capabilities: {
			metrics: new Set(['pageviews', 'visitors']),
			dimensions: new Set(['country', 'page']),
			filters: new Set(filters),
			filterOperators: new Set(operators),
			comparison: false,
			minGranularity: 'day',
			maxLookbackDays: null,
		},
		isConfigured: () => true,
		query: () =>
			Promise.resolve({
				rows: [],
				totals: { pageviews: 7, visitors: 7 },
				meta: { provider: 'test', fetchedAt: '2026-06-01T00:00:00.000Z' },
			}),
	}) as unknown as AnalyticsAdapter

const render = (req: PayloadRequest, widgetData: MetricWidgetData, view?: WidgetView) =>
	AnalyticsMetricWidget({ req, widgetData, view } as unknown as WidgetServerProps)

const renderHtml = async (
	req: PayloadRequest,
	widgetData: MetricWidgetData,
	view?: WidgetView
): Promise<string> => renderToStaticMarkup(await render(req, widgetData, view))

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

const view = {
	path: '/analytics',
	defaultRange: 'last30days',
	defaultMetric: 'pageviews',
} as const

describe('AnalyticsMetricWidget', () => {
	it('resolves the reporting timezone once, inside the read, for a preset timeframe', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await render(req, { metric: 'pageviews', timeframe: 'last30days' })
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('resolves it up front for a custom range, so the window is read in it', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await render(req, {
			metric: 'pageviews',
			timeframe: 'custom',
			range: { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' },
		})
		// Once for the range and caption, once for the read's own scope resolution.
		expect(resolveScope).toHaveBeenCalledTimes(2)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('links into the view on its own metric, window and the adapter that served it', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(
			req,
			{ metric: 'visitors', timeframe: 'last7days', dataSource: 'plausible' },
			view
		)
		expect(html).toContain('analytics:widgetOpenInView')
		// `test` is the adapter the read resolved to, not the `plausible` the widget asked for.
		expect(hrefIn(html)).toBe('/admin/analytics?range=last7days&source=test&metric=visitors')
	})

	it('spells a custom window as days in the reporting timezone', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'custom',
				range: { from: '2026-06-01', to: '2026-06-22' },
			},
			view
		)
		expect(hrefIn(html)).toBe(
			'/admin/analytics?range=custom&from=2026-06-01&to=2026-06-22&source=test'
		)
	})

	it('omits a range and metric the install already defaults to', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(
			req,
			{ metric: 'visitors', timeframe: 'today' },
			{
				path: '/analytics',
				defaultRange: 'today',
				defaultMetric: 'visitors',
			}
		)
		expect(hrefIn(html)).toBe('/admin/analytics?source=test')
	})

	it('renders no link when the app turned the view off', async () => {
		const { req } = bootFakeRuntime()
		const html = await renderHtml(req, { metric: 'pageviews' }, false)
		expect(html).not.toContain('analytics-widget__link')
		expect(html).not.toContain('analytics:widgetOpenInView')
	})

	it('appends the filter sentence to the caption', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['country']))
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'country', operator: 'eq', value: 'DE' },
			},
			view
		)
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq DE'
		)
	})

	it('leaves the caption alone when the widget carries no filter', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['country']))
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		expect(html).toContain('analytics:timeframeLast7Days')
		expect(html).not.toContain('analytics:widgetFilterCaption')
		expect(html).not.toContain('analytics:filterOperatorEq')
	})

	it('says the source cannot apply the filter instead of showing an unfiltered number', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['page']))
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'country', operator: 'eq', value: 'DE' },
			},
			view
		)
		expect(html).toContain('analytics:stateFilterUnsupported')
		expect(html).not.toContain('analytics:stateUnavailable')
		expect(html).not.toContain('>7<')
	})

	it('holds the caption back when there is no number to caption', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['page']))
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'country', operator: 'eq', value: 'DE' },
			},
			view
		)
		expect(html).not.toContain('analytics:timeframeLast7Days')
		expect(html).not.toContain('analytics:viewDimensionCountry')
	})

	it('says the number is approximate when the read hit the source event scan cap', async () => {
		const sampling = {
			...filterableAdapter(['country']),
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { pageviews: 7 },
					meta: { provider: 'test', fetchedAt: '2026-06-01T00:00:00.000Z', sampled: true },
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(sampling)
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		expect(html).toContain('analytics:stateSampled')
	})

	it('says a conversions total stands on goals the source could not read', async () => {
		const unresolvedGoals = {
			...filterableAdapter(['country']),
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { pageviews: 0 },
					meta: {
						provider: 'test',
						fetchedAt: '2026-06-01T00:00:00.000Z',
						goalsUnresolved: true,
					},
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(unresolvedGoals)
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		expect(html).toContain('analytics:stateGoalsUnresolved')
	})

	it('leaves both notes off a read the source answered in full', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['country']))
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		expect(html).not.toContain('analytics:stateSampled')
		expect(html).not.toContain('analytics:stateGoalsUnresolved')
	})

	it('carries the filter into the view link', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['country']))
		const html = await renderHtml(
			req,
			{
				metric: 'pageviews',
				timeframe: 'last7days',
				filter: { dimension: 'country', operator: 'eq', value: '  DE  ' },
			},
			view
		)
		const filters = new URLSearchParams(hrefIn(html)?.split('?')[1] ?? '').get('filters')
		expect(filters && JSON.parse(filters)).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
	})
})
