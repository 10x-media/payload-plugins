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

const req = (t: typeof fakeT = fakeT): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: { t, language: 'en' },
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

	it('opens the view on the tab that offers its dimension, grouped by that dimension', async () => {
		const html = await render(
			'analytics-breakdown-referrers',
			{ metric: 'visitors', timeframe: 'last7days' },
			view
		)
		expect(html).toContain('analytics:widgetOpenInView')
		expect(hrefIn(html)).toBe(
			'/admin/analytics?range=last7days&source=native&metric=visitors&tab=sources&dim=referrer'
		)
	})

	it('names the adapter that served the rows, not the one the widget asked for', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ adapterId: 'tenant-7' }))
		const html = await render('analytics-breakdown-pages', { dataSource: 'plausible' }, view)
		expect(hrefIn(html)).toBe('/admin/analytics?source=tenant-7')
	})

	it('maps each built-in breakdown to its own tab, naming the grouping only when it is not the default', async () => {
		const tabs = await Promise.all(
			[
				'analytics-breakdown-browsers',
				'analytics-breakdown-os',
				'analytics-breakdown-countries',
			].map(async (slug) => hrefIn(await render(slug, {}, view)))
		)
		expect(tabs).toEqual([
			'/admin/analytics?source=native&tab=technology&dim=browser',
			'/admin/analytics?source=native&tab=technology&dim=os',
			// `country` leads the geography tab, so the link is the one it always was.
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

	it('renders the unfiltered widget for a dimension the contract does not define', async () => {
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'last7days',
			filter: { dimension: 'countrey', value: 'DE' },
		} as unknown as BreakdownWidgetData)
		expect(vi.mocked(readForWidgetBreakdown).mock.calls[0]?.[0].filters).toEqual([])
		expect(html).toContain('analytics:timeframeLast7Days')
		expect(html).not.toContain('countrey')
	})

	it('reads an operator the contract does not define as eq', async () => {
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'last7days',
			filter: { dimension: 'country', operator: '', value: 'DE' },
		} as unknown as BreakdownWidgetData)
		expect(vi.mocked(readForWidgetBreakdown).mock.calls[0]?.[0].filters).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq DE'
		)
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

	it('joins the window and the sentence through the locale, not a hard-coded space', async () => {
		const tight = (key: string, vars?: Record<string, string | number>): string =>
			key === keys.widgetCaptionWithFilter
				? `${String(vars?.window)}${String(vars?.filter)}`
				: fakeT(key, vars)
		const html = renderToStaticMarkup(
			await AnalyticsBreakdownWidget({
				req: req(tight),
				widgetSlug: 'analytics-breakdown-pages',
				widgetData: {
					timeframe: 'last7days',
					filter: { dimension: 'country', operator: 'eq', value: 'DE' },
				},
			} as unknown as WidgetServerProps)
		)
		expect(html).toContain(
			'analytics:timeframeLast7Dayswhere analytics:viewDimensionCountry analytics:filterOperatorEq DE'
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

	it('notes a read the source answered without one of its filters', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ filtersUnapplied: true }))
		const html = await render('analytics-breakdown-pages')
		expect(html).toContain('analytics:stateFiltersUnapplied')
	})

	it('leaves the note off a read the source answered in full', async () => {
		const html = await render('analytics-breakdown-pages')
		expect(html).not.toContain('analytics:stateFiltersUnapplied')
	})

	it('names a native source row as a channel', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ provider: 'native', rows: [{ label: 'email', value: 9 }] })
		)
		const html = await render('analytics-breakdown-sources')
		expect(html).toContain('analytics:channelEmail')
	})

	it('leaves a provider source row as the raw utm_source it is', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ provider: 'plausible', rows: [{ label: 'email', value: 9 }] })
		)
		const html = await render('analytics-breakdown-sources')
		expect(html).not.toContain('analytics:channelEmail')
		expect(html).toContain('email')
	})

	it('says the goals could not be read instead of showing an empty goal table', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ rows: [], goalsUnresolved: true }))
		const html = await render('analytics-breakdown-goals')
		expect(html).toContain('analytics:stateGoalsUnresolved')
		expect(html).not.toContain('analytics:stateNoBreakdown')
	})

	it('says the scope configures no goals rather than that nobody converted', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ rows: [], noGoals: true }))
		const html = await render('analytics-breakdown-goals')
		expect(html).toContain('analytics:stateNoGoals')
		expect(html).not.toContain('analytics:stateNoBreakdown')
	})

	it('keeps the plain empty state on a goal read of a scope that has goals', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ rows: [] }))
		const html = await render('analytics-breakdown-goals')
		expect(html).toContain('analytics:stateNoBreakdown')
		expect(html).not.toContain('analytics:stateNoGoals')
	})

	it('never reads a non-goal breakdown of an install with no goals as a setup step', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ rows: [], noGoals: true }))
		const html = await render('analytics-breakdown-pages')
		expect(html).toContain('analytics:stateNoBreakdown')
		expect(html).not.toContain('analytics:stateNoGoals')
	})
})
