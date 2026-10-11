import type { Payload, PayloadRequest, WidgetServerProps } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter } from '../core/contract'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { renderSettled } from '../testing/renderSettled'
import { keys } from '../translations/keys'
import AnalyticsMetricWidget from './AnalyticsMetricWidget'
import type { MetricWidgetData } from './types'
import type { WidgetView } from './viewLink'
import { captionT, hrefIn, TEST_VIEW as view } from './widgetTestKit'

const unconfigured = {
	id: 'test',
	label: 'Test',
	capabilities: { metrics: new Set(['pageviews']) },
	isConfigured: () => false,
} as unknown as AnalyticsAdapter

const bootFakeRuntime = (adapter: AnalyticsAdapter = unconfigured, comparison = false) => {
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
		readAccess: () => true,
		engine: { read: (a: AnalyticsAdapter, query: unknown) => a.query(query as never, {}) },
		ttl: {},
		comparison,
		resolveScope,
		resolveTimezone,
	} as unknown as AnalyticsRuntime)
	const req = {
		payload,
		i18n: { t: captionT, language: 'en' },
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
			filters: Object.fromEntries(filters.map((dimension) => [dimension, operators])),
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
): Promise<string> => renderSettled(render(req, widgetData, view))

describe('AnalyticsMetricWidget', () => {
	it('resolves the reporting timezone once, inside the read, for a preset timeframe', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await renderHtml(req, { metric: 'pageviews', timeframe: 'last30days' })
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('resolves it up front for a custom range, so the window is read in it', async () => {
		const { req, resolveScope, resolveTimezone } = bootFakeRuntime()
		await renderHtml(req, {
			metric: 'pageviews',
			timeframe: 'custom',
			range: { from: '2026-05-31T22:00:00.000Z', to: '2026-06-22T22:00:00.000Z' },
		})
		// The range, the caption and the read's own scope all share the request's one resolution.
		expect(resolveScope).toHaveBeenCalledTimes(1)
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
		// The value isolated, so it keeps its own direction inside a right-to-left caption.
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq ⁨Germany⁩'
		)
	})

	// A read filtered to one currency counts its amounts as they were sent, in that currency.
	it('writes revenue in the currency its filter keeps', async () => {
		const base = filterableAdapter(['currency'])
		const money = {
			...base,
			capabilities: { ...base.capabilities, metrics: new Set(['revenue']) },
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { revenue: 12 },
					meta: { provider: 'test', fetchedAt: '2026-06-01T00:00:00.000Z' },
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(money)
		const filtered = await renderHtml(req, {
			metric: 'revenue',
			timeframe: 'last7days',
			filter: { dimension: 'currency', operator: 'eq', value: 'USD' },
		})
		expect(filtered).toContain('$12.00')
		expect(await renderHtml(req, { metric: 'revenue', timeframe: 'last7days' })).not.toContain(
			'$12.00'
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

	it('says the number is approximate when the source counted from a sample', async () => {
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

	it('says days are still being counted, values grouped, the zone missing and when it was updated', async () => {
		const degraded = {
			...filterableAdapter(['country']),
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { pageviews: 7 },
					meta: {
						provider: 'test',
						fetchedAt: '2026-06-01T00:00:00.000Z',
						partial: { missingDays: 1 },
						capped: { days: 2 },
						timezoneUnresolved: true,
						asOf: new Date(Date.now() - 120_000).toISOString(),
					},
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(degraded)
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		for (const key of [
			keys.statePartial,
			keys.stateCapped,
			keys.stateTimezoneUnresolved,
			keys.stateUpdated,
		]) {
			expect(html).toContain(key)
		}
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

	it('says no goals are configured when a conversions total has none behind it', async () => {
		const base = filterableAdapter(['country'])
		const goalless = {
			...base,
			capabilities: { ...base.capabilities, metrics: new Set(['pageviews', 'conversions']) },
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { conversions: 0 },
					meta: { provider: 'test', fetchedAt: '2026-06-01T00:00:00.000Z' },
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(goalless)
		const html = await renderHtml(req, { metric: 'conversions', timeframe: 'last7days' }, view)
		expect(html).toContain('analytics:stateNoGoals')
		expect(html).not.toContain('analytics:stateGoalsUnresolved')
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

	it('states the window on the title line, not under the number', async () => {
		const { req } = bootFakeRuntime(filterableAdapter(['country']))
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		const header = /<div class="analytics-widget__header"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? ''
		expect(header).toContain('analytics:metricPageviews')
		expect(header).toContain('analytics:timeframeLast7Days')
		expect(html.split('>analytics:timeframeLast7Days<')).toHaveLength(2)
	})

	it('puts the delta and its words beside the number', async () => {
		const base = filterableAdapter(['country'])
		const comparing = {
			...base,
			capabilities: { ...base.capabilities, comparison: true },
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(comparing, true)
		const html = await renderHtml(req, { metric: 'pageviews', timeframe: 'last7days' }, view)
		const row = html.slice(
			html.indexOf('analytics-widget__value-row'),
			html.indexOf('analytics-widget__footer')
		)
		expect(row).toContain('>7<')
		expect(row).toContain('aria-label="analytics:comparisonDirectionLabel"')
		expect(row).toContain('analytics-delta__caption">analytics:comparisonVsPrevious<')
	})

	// "0s" reads as a measured zero-second visit; an average with no pageviews is no data.
	it('writes a dash and draws no delta for an average with no samples', async () => {
		const base = filterableAdapter(['country'])
		const averaging = {
			...base,
			capabilities: {
				...base.capabilities,
				metrics: new Set(['pageviews', 'avgDuration']),
				comparison: true,
			},
			query: () =>
				Promise.resolve({
					rows: [],
					totals: { avgDuration: null },
					meta: { provider: 'test', fetchedAt: '2026-06-01T00:00:00.000Z' },
				}),
		} as unknown as AnalyticsAdapter
		const { req } = bootFakeRuntime(averaging, true)
		const html = await renderHtml(req, { metric: 'avgDuration', timeframe: 'last7days' }, view)
		expect(html).toMatch(
			/class="analytics-widget__value"><span aria-hidden="true">-<\/span><span class="analytics-sr-only">analytics:stateNoValue</
		)
		expect(html).not.toContain('analytics:comparisonVsPrevious')
		expect(html).not.toContain('0s')
	})
})

describe('AnalyticsMetricWidget custom range', () => {
	it('says a range before 1970 is invalid instead of reading the last 30 days', async () => {
		const query = vi.fn()
		const { req } = bootFakeRuntime({ ...filterableAdapter([]), query })
		const html = await renderHtml(
			req,
			{ metric: 'pageviews', timeframe: 'custom', range: { from: '1969-12-01', to: '1970-01-05' } },
			view
		)
		expect(html).toContain(keys.viewErrorInvalid)
		expect(html).not.toContain(keys.timeframeLast30Days)
		expect(query).not.toHaveBeenCalled()
	})
})
