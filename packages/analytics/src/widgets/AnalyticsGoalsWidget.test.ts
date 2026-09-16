import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsGoalsWidget from './AnalyticsGoalsWidget'
import { readForWidgetGoals, type WidgetGoalsResult } from './readForWidgetGoals'
import type { GoalsWidgetData } from './types'
import type { WidgetView } from './viewLink'

vi.mock('./readForWidgetGoals', () => ({ readForWidgetGoals: vi.fn() }))

const NOW = new Date('2026-06-03T12:00:00.000Z')

const result = (over: Partial<WidgetGoalsResult> = {}): WidgetGoalsResult => ({
	status: 'ok',
	adapterId: 'native',
	dateRange: { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW },
	timezone: 'UTC',
	rows: [
		{ slug: 'newsletter', name: 'Newsletter', conversions: 9, revenue: 0, rate: 0.083 },
		{ slug: 'purchase', name: 'Purchase', conversions: 5, revenue: 250, rate: 0.04 },
	],
	siteVisitors: 108,
	...over,
})

const req = (): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: { t: (key: string) => key, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (widgetData: GoalsWidgetData = {}, view?: WidgetView): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsGoalsWidget({ req: req(), widgetData, view } as unknown as WidgetServerProps)
	)

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

const view = { path: '/x', defaultRange: 'last30days', defaultMetric: 'pageviews' } as const

/** The rendered column headers, in order. */
const headers = (html: string): string[] =>
	Array.from(html.matchAll(/<th[^>]*>([^<]*)<\/th>/g), (m) => m[1] ?? '')

describe('AnalyticsGoalsWidget', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetGoals).mockReset()
	})

	it('renders one row per goal with its conversions, revenue and rate', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		const html = await render()
		expect(html).toContain('Newsletter')
		expect(html).toContain('Purchase')
		expect(html).toMatch(/>250<\/td>/)
		expect(html).toContain('8.3%')
	})

	it('heads the columns with the labels the view uses, in the same order', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		const html = await render()
		expect(headers(html)).toEqual([
			'analytics:fieldGoalLabel',
			'analytics:metricConversions',
			'analytics:metricRevenue',
			'analytics:viewConversionRate',
		])
	})

	it('dashes a row the source served no revenue for', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({
				rows: [
					{ slug: 'purchase', name: 'Purchase', conversions: 5, revenue: 250, rate: 0.04 },
					{ slug: 'newsletter', name: 'Newsletter', conversions: 9, rate: 0.083 },
				],
			})
		)
		const html = await render()
		expect(html).toMatch(/>-<\/td>/)
	})

	it('reads the row limit and comparison from the widget data', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		await render({ limit: '25', compare: true, dataSource: 'plausible' })
		expect(vi.mocked(readForWidgetGoals).mock.calls[0]?.[0]).toMatchObject({
			limit: 25,
			compare: true,
			adapterId: 'plausible',
		})
	})

	it('falls back to the default limit when the stored value is not an offered one', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		await render({ limit: '7' })
		expect(vi.mocked(readForWidgetGoals).mock.calls[0]?.[0]).toMatchObject({ limit: 10 })
	})

	it('omits the rate column when no row carries a rate', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({
				rows: [{ slug: 'purchase', name: 'Purchase', conversions: 5, revenue: 250 }],
				siteVisitors: undefined,
			})
		)
		const html = await render()
		expect(headers(html)).toEqual([
			'analytics:fieldGoalLabel',
			'analytics:metricConversions',
			'analytics:metricRevenue',
		])
	})

	it('omits the revenue column when the source serves no revenue', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({ rows: [{ slug: 'purchase', name: 'Purchase', conversions: 5, rate: 0.04 }] })
		)
		const html = await render()
		expect(headers(html)).toEqual([
			'analytics:fieldGoalLabel',
			'analytics:metricConversions',
			'analytics:viewConversionRate',
		])
	})

	it('shows the period-over-period delta on conversions when the read compared', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(
			result({
				rows: [
					{ slug: 'purchase', name: 'Purchase', conversions: 5, previousConversions: 4 },
					{ slug: 'newsletter', name: 'Newsletter', conversions: 9 },
				],
			})
		)
		const html = await render({ compare: true })
		expect(html).toContain('analytics:comparisonVsPrevious')
		// One row compared, one without a baseline: exactly one delta chip.
		expect(html.split('role="img"').length - 1).toBe(1)
	})

	it('renders the empty state when the read returned no goals', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateNoBreakdown')
		expect(html).not.toContain('<table')
	})

	it('renders the not-supported state when the source cannot serve goals', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ status: 'unavailable', rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateUnavailable')
		expect(html).not.toContain('<table')
	})

	it('renders the not-configured state', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ status: 'not-configured', rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateNotConfigured')
	})

	it('badges a stale-served read', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ stale: true }))
		expect(await render()).toContain('analytics:viewStale')
		expect(await render()).not.toContain('analytics:stateClamped')
	})

	it('notes a clamped range', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ clamped: true }))
		expect(await render()).toContain('analytics:stateClamped')
	})

	it('captions the timeframe and titles the card', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		expect(await render()).toContain('analytics:timeframeLast30Days')
		expect(await render()).toContain('analytics:widgetGoals')
		expect(await render({ title: 'Signups' })).toContain('Signups')
	})

	it('links into the view on its goals tab, naming the adapter that served the rows', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ adapterId: 'tenant-7' }))
		const html = await render({ timeframe: 'last7days', dataSource: 'plausible' }, view)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe(
			'/admin/x?range=last7days&source=tenant-7&metric=conversions&tab=goals'
		)
	})

	// The goals tab ranks by the view's metric, so a link without one opens the tab ranked by
	// the install default rather than by the conversions the card is ranked by.
	it('carries the metric it ranks by and the comparison it was configured with', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		const params = new URLSearchParams(
			(hrefIn(await render({ compare: true }, view)) ?? '').split('?')[1]
		)
		expect(params.get('metric')).toBe('conversions')
		expect(params.get('compare')).toBe('1')
		expect(
			new URLSearchParams((hrefIn(await render({}, view)) ?? '').split('?')[1]).has('compare')
		).toBe(false)
	})

	it('omits a range the install already defaults to', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		const html = await render({ timeframe: 'last7days' }, { ...view, defaultRange: 'last7days' })
		expect(hrefIn(html)).toBe('/admin/x?source=native&metric=conversions&tab=goals')
	})

	it('renders no link when the app turned the view off', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result())
		expect(await render({}, false)).not.toContain('analytics-widget__link')
	})

	it('says the goals could not be read rather than showing them as unconverted', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ rows: [], goalsUnresolved: true }))
		const html = await render()
		expect(html).toContain('analytics:stateGoalsUnresolved')
		expect(html).not.toContain('analytics:stateNoBreakdown')
	})

	it('keeps the plain empty state when the source answered and nobody converted', async () => {
		vi.mocked(readForWidgetGoals).mockResolvedValue(result({ rows: [] }))
		const html = await render()
		expect(html).toContain('analytics:stateNoBreakdown')
		expect(html).not.toContain('analytics:stateGoalsUnresolved')
	})
})
