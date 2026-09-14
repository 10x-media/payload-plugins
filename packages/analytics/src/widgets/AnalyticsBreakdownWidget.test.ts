import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsBreakdownWidget from './AnalyticsBreakdownWidget'
import type { BreakdownWidgetData } from './breakdownTypes'
import { readForWidgetBreakdown, type WidgetBreakdownResult } from './readForWidgetBreakdown'
import type { WidgetView } from './viewLink'

vi.mock('./readForWidgetBreakdown', () => ({ readForWidgetBreakdown: vi.fn() }))

const NOW = new Date('2026-06-03T12:00:00.000Z')

const result = (): WidgetBreakdownResult => ({
	status: 'ok',
	adapterId: 'native',
	dateRange: { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW },
	rows: [{ label: 'google.com', value: 12 }],
})

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
			{ path: '/analytics' }
		)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe('/admin/analytics?range=last7days&metric=visitors&tab=sources')
	})

	it('maps each built-in breakdown to its own tab', async () => {
		const tabs = await Promise.all(
			['analytics-breakdown-browsers', 'analytics-breakdown-countries'].map(async (slug) =>
				hrefIn(await render(slug, {}, { path: '/analytics' }))
			)
		)
		expect(tabs).toEqual(['/admin/analytics?tab=technology', '/admin/analytics?tab=geography'])
	})

	it('renders no link when the app turned the view off', async () => {
		const html = await render('analytics-breakdown-pages', {}, false)
		expect(html).not.toContain('analytics-widget__link')
	})
})
