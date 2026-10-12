import type { PayloadRequest, WidgetServerProps } from 'payload'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSettled } from '../testing/renderSettled'
import { keys } from '../translations/keys'
import AnalyticsBreakdownWidget from './AnalyticsBreakdownWidget'
import type { BreakdownWidgetData } from './breakdownTypes'
import { readForWidgetBreakdown, type WidgetBreakdownResult } from './readForWidgetBreakdown'
import type { WidgetView } from './viewLink'
import { captionT, hrefIn, TEST_VIEW as view } from './widgetTestKit'

vi.mock('./readForWidgetBreakdown', () => ({ readForWidgetBreakdown: vi.fn() }))

const NOW = new Date('2026-06-03T12:00:00.000Z')

const result = (over: Partial<WidgetBreakdownResult> = {}): WidgetBreakdownResult => ({
	status: 'ok',
	adapterId: 'native',
	dateRange: { start: new Date('2026-05-04T00:00:00.000Z'), end: NOW },
	rows: [{ label: 'google.com', dimensionValue: 'google.com', value: 12 }],
	...over,
})

const req = (t: typeof captionT = captionT): PayloadRequest =>
	({
		payload: { config: { routes: { admin: '/admin' } } } as unknown as PayloadRequest['payload'],
		i18n: { t, language: 'en' },
	}) as unknown as PayloadRequest

const render = async (
	widgetSlug: string,
	widgetData: BreakdownWidgetData = {},
	view?: WidgetView
): Promise<string> =>
	renderSettled(
		AnalyticsBreakdownWidget({
			req: req(),
			widgetSlug,
			widgetData,
			view,
		} as unknown as WidgetServerProps)
	)

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
			// `country` leads the geography tab, so the link carries no `dim`.
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
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq \u2068Germany\u2069'
		)
	})

	it('appends the filter sentence to the caption', async () => {
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'last7days',
			filter: { dimension: 'country', operator: 'eq', value: 'DE' },
		})
		expect(html).toContain(
			'analytics:timeframeLast7Days where analytics:viewDimensionCountry analytics:filterOperatorEq \u2068Germany\u2069'
		)
	})

	it('joins the window and the sentence through the locale, not a hard-coded space', async () => {
		const tight = (key: string, vars?: Record<string, string | number>): string =>
			key === keys.widgetCaptionWithFilter
				? `${String(vars?.window)}${String(vars?.filter)}`
				: captionT(key, vars)
		const html = await renderSettled(
			AnalyticsBreakdownWidget({
				req: req(tight),
				widgetSlug: 'analytics-breakdown-pages',
				widgetData: {
					timeframe: 'last7days',
					filter: { dimension: 'country', operator: 'eq', value: 'DE' },
				},
			} as unknown as WidgetServerProps)
		)
		expect(html).toContain(
			'analytics:timeframeLast7Dayswhere analytics:viewDimensionCountry analytics:filterOperatorEq \u2068Germany\u2069'
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

	it('centers the empty list message in the body', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(result({ rows: [] }))
		const html = await render('analytics-breakdown-pages')
		expect(html).toMatch(/class="analytics-widget__empty"[^>]*>analytics:stateNoBreakdown</)
		expect(html).not.toContain('analytics-bars')
	})

	// A row ranked by an average it has no samples for reads as no data, not as a zero.
	it('writes a dash for a row with no reading', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				rows: [
					{ label: '/pricing', dimensionValue: '/pricing', value: 4000 },
					{ label: '/thanks', dimensionValue: '/thanks', value: null },
				],
			})
		)
		const html = await render('analytics-breakdown-pages', { metric: 'avgDuration' })
		expect(html).toMatch(
			/class="analytics-bars__value"><span aria-hidden="true">-<\/span><span class="analytics-sr-only">analytics:stateNoValue</
		)
		expect(html).not.toContain('>0s<')
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

	it('names the native direct source, which is the one origin that is not a name', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				provider: 'native',
				rows: [{ label: 'direct', dimensionValue: 'direct', value: 9 }],
			})
		)
		const html = await render('analytics-breakdown-sources')
		expect(html).toContain('analytics:channelDirect')
	})

	it('leaves a native source row that is a utm_source tag as it was stored', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ provider: 'native', rows: [{ label: 'email', dimensionValue: 'email', value: 9 }] })
		)
		const html = await render('analytics-breakdown-sources')
		expect(html).not.toContain('analytics:channelEmail')
		expect(html).toContain('email')
	})

	it('leaves a provider source row as the raw value it is', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				provider: 'plausible',
				rows: [{ label: 'direct', dimensionValue: 'direct', value: 9 }],
			})
		)
		const html = await render('analytics-breakdown-sources')
		expect(html).not.toContain('analytics:channelDirect')
		expect(html).toContain('direct')
	})

	it('names a native channel row in the reader language', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				provider: 'native',
				rows: [{ label: 'paid-search', dimensionValue: 'paid-search', value: 9 }],
			})
		)
		const html = await render('analytics-breakdown-channels')
		expect(html).toContain('analytics:channelPaidSearch')
		expect(html).not.toContain('paid-search')
	})

	it("leaves a provider channel row in the provider's own vocabulary", async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				provider: 'ga4',
				rows: [{ label: 'Paid Search', dimensionValue: 'Paid Search', value: 9 }],
			})
		)
		const html = await render('analytics-breakdown-channels')
		expect(html).not.toContain('analytics:channelPaidSearch')
		expect(html).toContain('Paid Search')
	})

	// A light label over a partly filled bar would turn colour mid-letter; a soft bar keeps it dark.
	it('draws its bars soft, as the view does, so every label reads dark', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ rows: [{ label: '/pricing', dimensionValue: '/pricing', value: 9 }] })
		)
		const html = await render('analytics-breakdown-pages')
		expect(html).toContain('analytics-table analytics-bars analytics-bars--soft')
	})

	it('names a row the source answered with no value', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({ provider: 'posthog', rows: [{ label: '', dimensionValue: '', value: 9 }] })
		)
		const html = await render('analytics-breakdown-channels')
		expect(html).toContain('analytics:valueNotSet')
	})

	it('lists a goal by its name rather than its slug', async () => {
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(
			result({
				rows: [
					{ label: 'signup', dimensionValue: 'signup', value: 7 },
					{ label: 'retired', dimensionValue: 'retired', value: 1 },
				],
				goals: [{ slug: 'signup', name: 'Newsletter signup' }],
			})
		)
		const html = await render('analytics-breakdown-goals')
		expect(html).toContain('Newsletter signup')
		expect(html).not.toContain('>signup<')
		// A slug no configured goal claims still reads as itself.
		expect(html).toContain('retired')
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

describe('AnalyticsBreakdownWidget country flags', () => {
	const HostFlag = ({ code }: { code: string }) =>
		createElement('i', { className: 'host-flag', 'data-code': code })

	const countries = (): WidgetBreakdownResult =>
		result({
			rows: [
				{ label: 'DE', dimensionValue: 'DE', value: 9 },
				{ label: 'FR', dimensionValue: 'FR', value: 4 },
			],
		})

	const renderCountries = (countryFlags: unknown): Promise<string> =>
		renderSettled(
			AnalyticsBreakdownWidget({
				req: {
					payload: {
						config: { routes: { admin: '/admin', api: '/api' } },
						importMap: { '/components/HostFlag#HostFlag': HostFlag },
					},
					i18n: { t: captionT, language: 'en' },
				},
				widgetSlug: 'analytics-breakdown-countries',
				widgetData: {},
				countryFlags,
			} as unknown as WidgetServerProps)
		)

	beforeEach(() => {
		vi.mocked(readForWidgetBreakdown).mockReset()
		vi.mocked(readForWidgetBreakdown).mockResolvedValue(countries())
	})

	it("renders the host's flag component once per row, given that row's code", async () => {
		const html = await renderCountries({ Component: '/components/HostFlag#HostFlag' })
		expect([...html.matchAll(/class="host-flag" data-code="([A-Z]+)"/g)].map((m) => m[1])).toEqual([
			'DE',
			'FR',
		])
		expect(html).not.toContain('/_x/flags/')
	})

	it("draws the plugin's own flag from its route by default, and none when switched off", async () => {
		expect(await renderCountries(true)).toContain('/api/_x/flags/de.svg')
		const off = await renderCountries(false)
		expect(off).not.toContain('<img')
		expect(off).not.toContain('host-flag')
	})
})

describe('AnalyticsBreakdownWidget custom range', () => {
	beforeEach(() => {
		vi.mocked(readForWidgetBreakdown).mockReset()
	})

	it('says a range before 1970 is invalid instead of ranking the last 30 days', async () => {
		const html = await render('analytics-breakdown-pages', {
			timeframe: 'custom',
			range: { from: '1969-12-01', to: '1970-01-05' },
		})
		expect(html).toContain(keys.viewErrorInvalid)
		expect(readForWidgetBreakdown).not.toHaveBeenCalled()
	})
})
