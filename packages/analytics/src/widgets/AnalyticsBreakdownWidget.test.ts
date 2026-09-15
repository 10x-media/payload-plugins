import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsBreakdownWidget from './AnalyticsBreakdownWidget'
import type { BreakdownWidgetData } from './breakdownTypes'
import { readForWidgetBreakdown, type WidgetBreakdownResult } from './readForWidgetBreakdown'
import type { WidgetView } from './viewLink'

vi.mock('./readForWidgetBreakdown', () => ({ readForWidgetBreakdown: vi.fn() }))

const NOW = new Date('2026-06-03T12:00:00.000Z')

const result = (over: Partial<WidgetBreakdownResult> = {}): WidgetBreakdownResult => ({
	status: 'ok',
	adapterId: 'native',
	dateRange: { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW },
	rows: [{ label: 'google.com', value: 12 }],
	...over,
})

const view = { path: '/analytics', defaultRange: 'last30days', defaultMetric: 'pageviews' } as const

const req = (): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: { t: (key: string) => key, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (
	widgetSlug: string,
	widgetData: BreakdownWidgetData = {},
	view?: WidgetView
): Promise<string> =>
	renderToStaticMarkup(
		await AnalyticsBreakdownWidget({
			req: req(),
			widgetSlug,
			widgetData,
			view,
		} as unknown as WidgetServerProps)
	)

const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

describe('AnalyticsBreakdownWidget view link', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetBreakdown).mockReset()
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result())
	})

	it('opens the view on the tab that offers its dimension', async () => {
		const html = await render(
			'analytics-breakdown-referrers',
			{ metric: 'visitors', timeframe: 'last7days' },
			view
		)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe(
			'/admin/analytics?range=last7days&source=native&metric=visitors&tab=sources'
		)
	})

	it('names the adapter that served the rows, not the one the widget asked for', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ adapterId: 'tenant-7' }))
		const html = await render('analytics-breakdown-pages', { dataSource: 'plausible' }, view)
		expect(hrefIn(html)).toBe('/admin/analytics?source=tenant-7')
	})

	it('maps each built-in breakdown to its own tab', async () => {
		const tabs = await Promise.all(
			['analytics-breakdown-browsers', 'analytics-breakdown-countries'].map(async (slug) =>
				hrefIn(await render(slug, {}, view))
			)
		)
		expect(tabs).toEqual([
			'/admin/analytics?source=native&tab=technology',
			'/admin/analytics?source=native&tab=geography',
		])
	})

	it('renders no link when the app turned the view off', async () => {
		const html = await render('analytics-breakdown-pages', {}, false)
		expect(html).not.toContain('analytics-widget__link')
	})
})
