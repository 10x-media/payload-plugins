import type { PayloadRequest, WidgetServerProps } from 'payload'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
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

/**
 * Every key stands in for itself, except the caption sentence, which comes from the real
 * bundle so the assertion sees the same `{{vars}}` pass Payload's own `t` makes.
 */
const fakeT = (key: string, vars?: Record<string, string | number>): string =>
	(key === keys.widgetFilterCaption ? en[keys.widgetFilterCaption] : key).replace(
		/\{\{(.*?)\}\}/g,
		(match, name: string) => {
			const value = vars?.[name.trim()]
			return value === undefined ? match : String(value)
		}
	)

const req = (): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: { t: fakeT, language: 'en' },
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

describe('AnalyticsBreakdownWidget filter', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetBreakdown).mockReset()
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result())
	})

	it('passes the stored filter into the read, trimmed', async () => {
		await render('analytics-breakdown-pages', {
			filter: { dimension: 'country', operator: 'eq', value: '  DE  ' },
		})
		expect(vi.mocked(readForWidgetBreakdown).mock.calls[0]?.[0].filters).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
	})

	it('passes no filters at all for a half-filled group', async () => {
		await render('analytics-breakdown-pages', { filter: { operator: 'eq', value: 'DE' } })
		expect(vi.mocked(readForWidgetBreakdown).mock.calls[0]?.[0].filters).toEqual([])
	})

	it('appends the filter sentence to the caption', async () => {
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'last7days',
			filter: { dimension: 'country', operator: 'eq', value: 'DE' },
		})
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq DE'
		)
	})

	it('says the source cannot apply the filter instead of ranking unfiltered rows', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ status: 'filter-unsupported', rows: [] })
		)
		const html = await render('analytics-breakdown-pages', {
			filter: { dimension: 'country', operator: 'eq', value: 'DE' },
		})
		expect(html).toContain('analytics:stateFilterUnsupported')
		expect(html).not.toContain('analytics:stateUnavailable')
	})

	it('holds the caption back when there are no rows to caption', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ status: 'filter-unsupported', rows: [] })
		)
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'last7days',
			filter: { dimension: 'country', operator: 'eq', value: 'DE' },
		})
		expect(html).not.toContain('analytics:timeframeLast7Days')
		expect(html).not.toContain('analytics:viewDimensionCountry')
	})

	it('carries the filter into the view link', async () => {
		const html = await render(
			'analytics-breakdown-pages',
			{ filter: { dimension: 'country', operator: 'eq', value: 'DE' } },
			view
		)
		const carried = new URLSearchParams(hrefIn(html)?.split('?')[1] ?? '').get('filters')
		expect(carried && JSON.parse(carried)).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
	})
})
