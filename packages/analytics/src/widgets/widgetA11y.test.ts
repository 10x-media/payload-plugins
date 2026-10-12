// @vitest-environment jsdom
import type { PayloadRequest, WidgetServerProps } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { AnalyticsStatField } from '../fields/AnalyticsStatField'
import { setRuntime } from '../plugin/runtime'
import { a11yViolations } from '../testing/a11y'
import { memoryAdapter } from '../testing/memoryAdapter'
import { renderSettled } from '../testing/renderSettled'
import AnalyticsBreakdownWidget from './AnalyticsBreakdownWidget'
import AnalyticsGoalsWidget from './AnalyticsGoalsWidget'
import AnalyticsMetricWidget from './AnalyticsMetricWidget'
import AnalyticsRealtimeWidget from './AnalyticsRealtimeWidget'
import AnalyticsTrendWidget from './AnalyticsTrendWidget'
import { readForWidget } from './readForWidget'
import { readForWidgetBreakdown } from './readForWidgetBreakdown'
import { readForWidgetGoals } from './readForWidgetGoals'
import { readForWidgetRealtime } from './readForWidgetRealtime'
import { readForWidgetSeries } from './readForWidgetSeries'
import { TEST_VIEW as view } from './widgetTestKit'

vi.mock('./readForWidget', () => ({ readForWidget: vi.fn() }))
vi.mock('./readForWidgetBreakdown', () => ({ readForWidgetBreakdown: vi.fn() }))
vi.mock('./readForWidgetGoals', () => ({ readForWidgetGoals: vi.fn() }))
vi.mock('./readForWidgetRealtime', () => ({ readForWidgetRealtime: vi.fn() }))
vi.mock('./readForWidgetSeries', async (importOriginal) => ({
	...(await importOriginal<typeof import('./readForWidgetSeries')>()),
	readForWidgetSeries: vi.fn(),
}))
// The live counter is a client component, which reads its strings from Payload's provider.
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		i18n: { language: 'en', translations: {} },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${JSON.stringify(vars)}` : key,
	}),
}))

const NOW = new Date('2026-06-03T12:00:00.000Z')
const dateRange = { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW }

const req = (): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: {
			t: (key: string, vars?: Record<string, string>) =>
				vars ? `${key} ${JSON.stringify(vars)}` : key,
			language: 'en',
		},
	}) as unknown as PayloadRequest

/** The server's markup as the dashboard shows it, before any script runs. */
const mount = (html: string): HTMLElement => {
	document.body.innerHTML = html
	return document.body
}

afterEach(() => {
	document.body.innerHTML = ''
})

describe('dashboard widget accessibility', () => {
	it('draws a breakdown as a table: hidden column headers, each label its row header', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue({
			status: 'ok',
			adapterId: 'native',
			dateRange,
			rows: [
				{ label: '/pricing', dimensionValue: '/pricing', value: 12 },
				{ label: '/about', dimensionValue: '/about', value: 6 },
			],
		})
		const body = mount(
			await renderSettled(
				AnalyticsBreakdownWidget({
					req: req(),
					widgetSlug: 'analytics-breakdown-pages',
					widgetData: { metric: 'pageviews' },
					view,
				} as unknown as WidgetServerProps)
			)
		)
		expect(a11yViolations(body)).toEqual([])
		const table = body.querySelector('table')
		expect(table?.getAttribute('aria-label')).toBe('analytics:widgetBreakdownPages')
		expect(table?.querySelector('thead')?.className).toBe('analytics-sr-only')
		expect([...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent)).toEqual([
			'analytics:viewDimensionPage',
			'analytics:metricPageviews',
		])
		expect(
			[...(table?.querySelectorAll('tbody th[scope="row"]') ?? [])].map((th) => th.textContent)
		).toEqual(['/pricing', '/about'])
		expect(body.querySelector('h2')?.textContent).toBe('analytics:widgetBreakdownPages')
	})

	it('draws the goals table with the delta pill in its conversions cells', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue({
			status: 'ok',
			adapterId: 'native',
			dateRange,
			timezone: 'UTC',
			rows: [
				{ slug: 'purchase', name: 'Purchase', conversions: 5, previousConversions: 4, rate: 0.04 },
			],
			siteVisitors: 108,
		})
		const body = mount(
			await renderSettled(
				AnalyticsGoalsWidget({
					req: req(),
					widgetData: { compare: true },
					view,
				} as unknown as WidgetServerProps)
			)
		)
		expect(a11yViolations(body)).toEqual([])
		expect(body.querySelector('tbody th[scope="row"]')?.textContent).toBe('Purchase')
		const delta = body.querySelector('td .analytics-delta')
		expect(delta?.getAttribute('role')).toBe('img')
		expect(delta?.getAttribute('aria-label')).toContain('analytics:comparisonChangeLabel')
		expect(delta?.getAttribute('aria-label')).toContain(
			'"direction":"analytics:comparisonIncrease"'
		)
		expect(body.querySelector('.analytics-delta__change--up')).not.toBeNull()
	})

	it('names the metric card and its delta', async () => {
		vi.mocked(readForWidget).mockResolvedValue({
			status: 'ok',
			adapterId: 'native',
			dateRange,
			metrics: { pageviews: 120 },
			previousMetrics: { pageviews: 100 },
			comparisonRange: dateRange,
		})
		const body = mount(
			await renderSettled(
				AnalyticsMetricWidget({
					req: req(),
					widgetData: { metric: 'pageviews' },
					view,
				} as unknown as WidgetServerProps)
			)
		)
		expect(a11yViolations(body)).toEqual([])
		expect(body.querySelector('h2')?.textContent).toBe('analytics:metricPageviews')
		expect(body.querySelector('.analytics-delta')?.getAttribute('aria-label')).toContain(
			'analytics:comparisonChangeLabel'
		)
	})

	it('gives the trend chart a data table and its card a heading', async () => {
		vi.mocked(readForWidgetSeries).mockResolvedValue({
			status: 'ok',
			adapterId: 'native',
			dateRange,
			timezone: 'UTC',
			points: [
				{ date: '2026-06-01T00:00:00.000Z', value: 4 },
				{ date: '2026-06-02T00:00:00.000Z', value: 6 },
			],
			seriesGranularity: 'day',
			total: 10,
		})
		const body = mount(
			await renderSettled(
				AnalyticsTrendWidget({
					req: req(),
					widgetData: { metric: 'pageviews' },
					view,
				} as unknown as WidgetServerProps)
			)
		)
		expect(a11yViolations(body)).toEqual([])
		expect(body.querySelector('table')).not.toBeNull()
		expect(body.querySelector('h2')?.textContent).toBe('analytics:metricPageviews')
	})

	it('announces the live count from a hidden region only', async () => {
		vi.mocked(readForWidgetRealtime).mockResolvedValue({
			status: 'ok',
			adapterId: 'native',
			activeNow: 7,
			series: [{ date: '2026-06-03T12:00:00.000Z', value: 7 }],
		})
		const body = mount(
			await renderSettled(
				AnalyticsRealtimeWidget({
					req: req(),
					widgetData: {},
					view,
				} as unknown as WidgetServerProps)
			)
		)
		expect(a11yViolations(body)).toEqual([])
		expect(body.querySelector('[aria-live]')?.classList.contains('analytics-sr-only')).toBe(true)
	})

	it('draws a stat row whose numbers are named', async () => {
		const adapter = memoryAdapter()
		adapter.record({ path: '/pricing', timestamp: new Date() })
		const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
		setRuntime(payload, {
			registry: createRegistry([adapter]),
			configAdapterIds: new Set([adapter.id]),
			bindings: { pages: { pathField: 'slug', scopeField: false } },
			readAccess: () => true,
			engine: { read: async (source, query) => source.query(query, {}) },
			ttl: { aggregate: 3600, realtime: 300 },
			comparison: false,
		})
		const body = mount(
			await renderSettled(
				AnalyticsStatField({
					req: { payload } as PayloadRequest,
					data: { slug: '/pricing' },
					collectionSlug: 'pages',
					i18n: { t: (key: string) => key, language: 'en' },
					metrics: ['pageviews', 'visitors'],
					timeframe: 'last7days',
					variant: 'row',
				})
			)
		)
		expect(a11yViolations(body)).toEqual([])
		expect(body.querySelectorAll('.analytics-metric').length).toBe(2)
	})
})
