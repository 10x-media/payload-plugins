import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { AnalyticsFilter, AnalyticsRow, DimensionKey, MetricKey } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import { declarationsOf } from '../../testing/stylesheet'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import type { CountryFlagProps, CountryFlags } from '../CountryFlag'
import type { BreakdownTab } from '../gating'
import { DIMENSION_LABELS, TAB_LABELS } from '../labels'
import type { ViewLimit } from '../state'
import type { QueryState } from '../useViewQueries'
import { Breakdowns } from './Breakdowns'

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../../testing/selectMocks')).selectMocks,
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	ShimmerEffect: ({ className }: { className?: string }) => (
		<div aria-hidden="true" className={className} />
	),
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	Pill: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
	XIcon: () => <span aria-hidden="true" />,
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page'],
	filters: { page: ['eq'] },
	realtime: false,
	comparison: false,
	minGranularity: 'day',
	maxLookbackDays: null,
} as unknown as SerializedCapabilities

const rows: AnalyticsRow[] = [
	{ dimensions: { page: '/pricing' }, metrics: { pageviews: 120, visitors: 90 } },
	{ dimensions: { page: '/about' }, metrics: { pageviews: 60, visitors: 40 } },
]

const answer = (): QueryResponse => ({
	result: { rows, meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' } },
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities,
	query: {
		metrics: ['pageviews', 'visitors'],
		dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
	},
})

const state = (over: Partial<QueryState<QueryResponse>> = {}): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	data: answer(),
	...over,
})

/** A read that answered `rows`, as `provider` serves them. */
const answering = (rows: AnalyticsRow[], provider = 'native'): QueryState<QueryResponse> =>
	state({
		data: {
			...answer(),
			result: { rows, meta: { provider, fetchedAt: '2026-09-14T00:00:00.000Z' } },
		},
	})

const ALL_TABS: BreakdownTab[] = ['pages', 'sources', 'technology', 'geography', 'events', 'goals']

interface BreakdownsOverrides {
	tabs?: BreakdownTab[]
	tab?: BreakdownTab
	dimension?: DimensionKey
	dimensions?: DimensionKey[]
	columns?: MetricKey[]
	countryFlags?: CountryFlags
	canFilter?: boolean
	query?: QueryState<QueryResponse>
	limit?: ViewLimit
	currency?: string
	siteVisitors?: number
	filters?: AnalyticsFilter[]
	order?: { metric: 'pageviews' | 'visitors'; direction: 'asc' | 'desc' }
	onTabChange?: (tab: BreakdownTab) => void
	onDimensionChange?: (dimension: DimensionKey) => void
	onLimitChange?: (limit: number) => void
	onSortChange?: (order: { metric: string; direction: 'asc' | 'desc' }) => void
	onRowSelect?: (value: string) => void
	onFilterRemove?: (index: number) => void
}

const breakdowns = (over: BreakdownsOverrides = {}) => (
	<Breakdowns
		canFilter={over.canFilter ?? true}
		dimension={over.dimension ?? 'page'}
		dimensions={over.dimensions ?? ['page']}
		limit={over.limit ?? 10}
		locale="en"
		columns={over.columns ?? ['pageviews', 'visitors']}
		countryFlags={over.countryFlags ?? true}
		currency={over.currency}
		siteVisitors={over.siteVisitors}
		filters={over.filters}
		goals={[]}
		onDimensionChange={over.onDimensionChange ?? (() => {})}
		onFilterRemove={over.onFilterRemove}
		onLimitChange={over.onLimitChange ?? (() => {})}
		onRowSelect={over.onRowSelect ?? (() => {})}
		onSortChange={over.onSortChange ?? (() => {})}
		onTabChange={over.onTabChange ?? (() => {})}
		order={over.order}
		query={over.query ?? state()}
		tab={over.tab ?? 'pages'}
		tabs={over.tabs ?? ALL_TABS}
	/>
)

const renderBreakdowns = (over: BreakdownsOverrides = {}) => render(breakdowns(over))

const tabButtons = (): HTMLElement[] => screen.getAllByRole('tab')

afterEach(() => {
	cleanup()
})

describe('Breakdowns tabs', () => {
	it('offers only the groups the source serves', () => {
		renderBreakdowns({ tabs: ['pages', 'geography'] })
		expect(tabButtons().map((tab) => tab.textContent)).toEqual([
			TAB_LABELS.pages,
			TAB_LABELS.geography,
		])
	})

	it('marks the active tab and switches on click', () => {
		const onTabChange = vi.fn()
		renderBreakdowns({ onTabChange })
		expect(tabButtons()[0]?.getAttribute('aria-selected')).toBe('true')
		fireEvent.click(tabButtons()[1] as HTMLElement)
		expect(onTabChange).toHaveBeenCalledWith('sources')
	})

	it('moves the selection with the arrow keys', () => {
		const onTabChange = vi.fn()
		const { rerender } = renderBreakdowns({ onTabChange, tabs: ['pages', 'sources'] })
		fireEvent.keyDown(tabButtons()[0] as HTMLElement, { key: 'ArrowRight' })
		expect(onTabChange).toHaveBeenCalledWith('sources')
		rerender(breakdowns({ onTabChange, tab: 'sources', tabs: ['pages', 'sources'] }))
		expect(tabButtons()[1]?.getAttribute('aria-selected')).toBe('true')
		expect(tabButtons()[0]?.getAttribute('aria-selected')).toBe('false')
	})

	it('wraps the arrow keys around the strip', () => {
		const onTabChange = vi.fn()
		renderBreakdowns({ onTabChange, tabs: ['pages', 'sources'] })
		fireEvent.keyDown(tabButtons()[0] as HTMLElement, { key: 'ArrowLeft' })
		expect(onTabChange).toHaveBeenCalledWith('sources')
	})
})

describe('Breakdowns group-by picker', () => {
	const TECHNOLOGY: DimensionKey[] = ['device', 'browser', 'os']

	it('stays away on a tab that groups by one dimension', () => {
		renderBreakdowns()
		expect(screen.queryByLabelText(keys.viewGroupBy)).toBeNull()
	})

	it('lists every dimension the tab groups by and reports the pick', () => {
		const onDimensionChange = vi.fn()
		renderBreakdowns({
			dimension: 'device',
			dimensions: TECHNOLOGY,
			onDimensionChange,
			tab: 'technology',
		})
		const picker = screen.getByLabelText(keys.viewGroupBy)
		expect([...picker.querySelectorAll('option')].map((option) => option.textContent)).toEqual(
			TECHNOLOGY.map((dimension) => DIMENSION_LABELS[dimension])
		)
		fireEvent.change(picker, { target: { value: 'browser' } })
		expect(onDimensionChange).toHaveBeenCalledWith('browser')
	})

	it('names and filters on the dimension picked, not on the tab default', () => {
		const onRowSelect = vi.fn()
		const browsers: AnalyticsRow[] = [
			{ dimensions: { browser: 'chrome' }, metrics: { pageviews: 9 } },
		]
		renderBreakdowns({
			dimension: 'browser',
			dimensions: TECHNOLOGY,
			onRowSelect,
			query: answering(browsers),
			tab: 'technology',
		})
		expect(screen.getAllByRole('columnheader')[0]?.textContent).toBe(DIMENSION_LABELS.browser)
		// The row reads as the browser's name and still filters on the value as stored.
		fireEvent.click(screen.getByRole('button', { name: new RegExp(keys.valueBrowserChrome) }))
		expect(onRowSelect).toHaveBeenCalledWith('chrome')
	})

	it('names a country row and draws its flag, or drops the flag on request', () => {
		const countries: AnalyticsRow[] = [{ dimensions: { country: 'DE' }, metrics: { pageviews: 9 } }]
		const query = answering(countries)
		renderBreakdowns({ dimension: 'country', dimensions: ['country'], query, tab: 'geography' })
		expect(screen.getByText(/Germany/)).toBeDefined()
		expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/_x/flags/de.svg')

		cleanup()
		renderBreakdowns({
			countryFlags: false,
			dimension: 'country',
			dimensions: ['country'],
			query,
			tab: 'geography',
		})
		expect(screen.getByText(/Germany/)).toBeDefined()
		expect(document.querySelector('img')).toBeNull()
	})

	it("draws the host's flag on each country row, handing it the row's code", () => {
		const HostFlag = ({ code }: CountryFlagProps) => <i className="host-flag" data-code={code} />
		const countries: AnalyticsRow[] = [
			{ dimensions: { country: 'DE' }, metrics: { pageviews: 9 } },
			{ dimensions: { country: 'fr' }, metrics: { pageviews: 4 } },
		]
		const query = answering(countries)
		renderBreakdowns({
			countryFlags: { Component: HostFlag },
			dimension: 'country',
			dimensions: ['country'],
			query,
			tab: 'geography',
		})
		const drawn = [...document.querySelectorAll('.host-flag')].map((flag) =>
			flag.getAttribute('data-code')
		)
		expect(drawn).toEqual(['DE', 'FR'])
		expect(document.querySelector('img')).toBeNull()
	})

	it('waits rather than ranking the previous grouping under the new label', () => {
		// The `page` rows are still on screen from the read before the pick, which is what the
		// refetch deliberately keeps. They carry no browser, so they are not rows of this list.
		renderBreakdowns({
			dimension: 'browser',
			dimensions: TECHNOLOGY,
			query: state({ isRefetching: true }),
			tab: 'technology',
		})
		expect(screen.queryByText('/pricing')).toBeNull()
		expect(screen.queryByText(keys.stateNoBreakdown)).toBeNull()
		expect(document.querySelectorAll('.analytics-bars__row')).toHaveLength(0)
	})
})

describe('Breakdowns rows', () => {
	// A page that only ever saw an event has no average time on it, which is no data, and its
	// column says so with a dash rather than a zero-second visit.
	it('writes a dash in an average column for a row with no samples', () => {
		const averages: AnalyticsRow[] = [
			{ dimensions: { page: '/pricing' }, metrics: { avgDuration: 4000, visitors: 9 } },
			{ dimensions: { page: '/thanks' }, metrics: { avgDuration: null, visitors: 3 } },
		]
		const { container } = renderBreakdowns({
			columns: ['avgDuration', 'visitors'],
			query: answering(averages),
		})
		const values = [...container.querySelectorAll('.analytics-bars__value')]
		// A dash on screen, "no value" to a screen reader rather than "minus".
		expect(values[1]?.querySelector('[aria-hidden="true"]')?.textContent).toBe('-')
		expect(values[1]?.querySelector('.analytics-sr-only')?.textContent).toBe(keys.stateNoValue)
		expect(values.map((cell) => cell.textContent)).not.toContain('0s')
	})

	it('renders a filterable row as a button that reports its value', () => {
		const onRowSelect = vi.fn()
		renderBreakdowns({ onRowSelect })
		fireEvent.click(screen.getByRole('button', { name: /\/pricing/ }))
		expect(onRowSelect).toHaveBeenCalledWith('/pricing')
	})

	it('leaves the rows inert and says why when the source cannot filter', () => {
		const onRowSelect = vi.fn()
		renderBreakdowns({ canFilter: false, onRowSelect })
		expect(screen.queryByRole('button', { name: /\/pricing/ })).toBeNull()
		expect(screen.getByText('/pricing')).toBeDefined()
		expect(screen.getByText(keys.viewFiltersUnsupported)).toBeDefined()
	})

	it('shows the visitors column the read served beside the charted metric', () => {
		renderBreakdowns()
		expect(screen.getByText('90')).toBeDefined()
	})

	it('names a traffic channel in the reader language and still filters on the stored value', () => {
		const onRowSelect = vi.fn()
		const channels: AnalyticsRow[] = [
			{ dimensions: { channel: 'organic-search' }, metrics: { pageviews: 9 } },
		]
		renderBreakdowns({
			dimension: 'channel',
			dimensions: ['channel', 'referrer'],
			onRowSelect,
			query: answering(channels),
			tab: 'sources',
		})
		expect(screen.getByText(keys.channelOrganicSearch)).toBeDefined()
		expect(screen.queryByText('organic-search')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: new RegExp(keys.channelOrganicSearch) }))
		expect(onRowSelect).toHaveBeenCalledWith('organic-search')
	})

	it("leaves a provider's channel row in the vocabulary that provider reports", () => {
		const channels: AnalyticsRow[] = [
			{ dimensions: { channel: 'Paid Search' }, metrics: { pageviews: 9 } },
		]
		renderBreakdowns({
			dimension: 'channel',
			dimensions: ['channel', 'referrer'],
			query: answering(channels, 'ga4'),
			tab: 'sources',
		})
		expect(screen.getByText('Paid Search')).toBeDefined()
		expect(screen.queryByText(keys.channelPaidSearch)).toBeNull()
	})

	it('names a row the source answered with no value, and does not offer it as a filter', () => {
		const onRowSelect = vi.fn()
		const channels: AnalyticsRow[] = [
			{ dimensions: { channel: '' }, metrics: { pageviews: 9 } },
			{ dimensions: { channel: 'Paid Search' }, metrics: { pageviews: 4 } },
		]
		renderBreakdowns({
			dimension: 'channel',
			dimensions: ['channel', 'referrer'],
			onRowSelect,
			query: answering(channels, 'posthog'),
			tab: 'sources',
		})
		expect(screen.getByText(keys.valueNotSet)).toBeDefined()
		expect(screen.queryByRole('button', { name: new RegExp(keys.valueNotSet) })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: /Paid Search/ }))
		expect(onRowSelect).toHaveBeenCalledWith('Paid Search')
	})

	it('sorts on a column header, and flips the direction on a second click', () => {
		const onSortChange = vi.fn()
		const { rerender } = renderBreakdowns({ onSortChange })
		fireEvent.click(screen.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(onSortChange).toHaveBeenCalledWith({ metric: 'visitors', direction: 'desc' })
		rerender(breakdowns({ onSortChange, order: { metric: 'visitors', direction: 'desc' } }))
		fireEvent.click(screen.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(onSortChange).toHaveBeenLastCalledWith({ metric: 'visitors', direction: 'asc' })
	})

	// A currency row counts its amounts as they were sent, so the reporting code would mislabel them.
	it('writes each currency row in its own code, and any other row in the reporting one', () => {
		const sent: AnalyticsRow[] = [
			{ dimensions: { currency: 'USD' }, metrics: { revenue: 90, conversions: 2 } },
			{ dimensions: { currency: 'JPY' }, metrics: { revenue: 1200, conversions: 1 } },
		]
		renderBreakdowns({
			tab: 'goals',
			dimension: 'currency',
			dimensions: ['goal', 'currency'],
			columns: ['revenue', 'conversions'],
			currency: 'EUR',
			query: answering(sent),
		})
		expect(screen.getByText('$90.00')).toBeDefined()
		expect(screen.getByText('¥1,200')).toBeDefined()
		cleanup()
		renderBreakdowns({
			columns: ['revenue'],
			currency: 'EUR',
			query: answering([{ dimensions: { page: '/checkout' }, metrics: { revenue: 20 } }]),
		})
		expect(screen.getByText('€20.00')).toBeDefined()
	})

	it('changes the row limit', () => {
		const onLimitChange = vi.fn()
		renderBreakdowns({ onLimitChange })
		fireEvent.change(screen.getByLabelText(keys.widgetFieldLimit), { target: { value: '50' } })
		expect(onLimitChange).toHaveBeenCalledWith(50)
	})

	it('charts a metric the rows carry when the selected one is not among them', () => {
		// A Umami-shaped answer: /metrics reports visitors per row and nothing else, so the
		// pageviews column the view asked for has no number on any row.
		const umamiRows: AnalyticsRow[] = [
			{ dimensions: { page: '/pricing' }, metrics: { visitors: 90 } },
			{ dimensions: { page: '/about' }, metrics: { visitors: 40 } },
		]
		renderBreakdowns({
			query: answering(umamiRows, 'umami'),
		})
		expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
			DIMENSION_LABELS.page,
			METRIC_KEYS.visitors,
		])
		expect(screen.getByText('90')).toBeDefined()
		expect(screen.queryByText('0')).toBeNull()
	})

	it('shows the empty copy when the read came back with no rows', () => {
		renderBreakdowns({ query: answering([]) })
		expect(screen.getByText(keys.stateNoBreakdown)).toBeDefined()
	})
})

describe('Breakdowns accessibility', () => {
	it('is a table: the dimension and metrics as column headers, each label its row header', () => {
		renderBreakdowns()
		const table = screen.getByRole('table', { name: DIMENSION_LABELS.page })
		expect(screen.getByRole('tabpanel').contains(table)).toBe(true)
		expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
			DIMENSION_LABELS.page,
			METRIC_KEYS.pageviews,
			METRIC_KEYS.visitors,
		])
		const rows = screen.getAllByRole('rowheader')
		expect(rows.map((header) => header.textContent)).toEqual(['/pricing', '/about'])
		// The filter is the row header's own button, named by the row it filters on.
		expect(rows[0]?.querySelector('button')?.textContent).toBe('/pricing')
	})

	it('says which column orders the rows, the first by default', () => {
		const { rerender } = renderBreakdowns()
		const sortState = () =>
			screen.getAllByRole('columnheader').map((header) => header.getAttribute('aria-sort'))
		expect(sortState()).toEqual([null, 'descending', null])
		rerender(breakdowns({ order: { metric: 'visitors', direction: 'asc' } }))
		expect(sortState()).toEqual([null, null, 'ascending'])
	})

	it('flips the default order from the column it already sorts by', () => {
		const onSortChange = vi.fn()
		renderBreakdowns({ onSortChange })
		fireEvent.click(screen.getByRole('button', { name: METRIC_KEYS.pageviews }))
		expect(onSortChange).toHaveBeenCalledWith({ metric: 'pageviews', direction: 'asc' })
	})

	it('leaves the rate column a plain header: there is nothing to sort it by', () => {
		const events: AnalyticsRow[] = [
			{ dimensions: { event: 'signup' }, metrics: { events: 9, visitors: 3 } },
		]
		renderBreakdowns({
			columns: ['events', 'visitors'],
			dimension: 'event',
			dimensions: ['event'],
			query: answering(events),
			siteVisitors: 30,
			tab: 'events',
		})
		const rate = screen.getByRole('columnheader', { name: keys.viewConversionRate })
		expect(rate.querySelector('button')).toBeNull()
	})

	it('steps the tabs with the arrow pointing along a right-to-left page', () => {
		const onTabChange = vi.fn()
		render(<div dir="rtl">{breakdowns({ onTabChange })}</div>)
		fireEvent.keyDown(tabButtons()[0] as HTMLElement, { key: 'ArrowLeft' })
		expect(onTabChange).toHaveBeenLastCalledWith('sources')
		fireEvent.keyDown(tabButtons()[0] as HTMLElement, { key: 'ArrowRight' })
		expect(onTabChange).toHaveBeenLastCalledWith('goals')
	})
})

describe('Breakdowns goal empty states', () => {
	const emptyGoalRead = (goalSlugs?: string[] | 'unresolved', goalsUnresolved?: true) =>
		state({
			data: {
				...answer(),
				result: {
					rows: [],
					meta: {
						provider: 'native',
						fetchedAt: '2026-09-14T00:00:00.000Z',
						...(goalsUnresolved ? { goalsUnresolved } : {}),
					},
				},
				query: { ...answer().query, ...(goalSlugs === undefined ? {} : { goalSlugs }) },
			},
		})

	const renderGoalTab = (query: QueryState<QueryResponse>) =>
		renderBreakdowns({ dimension: 'goal', dimensions: ['goal'], query, tab: 'goals' })

	it('says the scope configures no goals when the read was hinted an empty list', () => {
		renderGoalTab(emptyGoalRead([]))
		expect(screen.getByText(keys.stateNoGoals)).toBeDefined()
	})

	it('keeps the plain empty state when the scope has goals and none converted', () => {
		renderGoalTab(emptyGoalRead(['signup']))
		expect(screen.getByText(keys.stateNoBreakdown)).toBeDefined()
	})

	it('keeps saying the source could not answer when the resolver failed', () => {
		renderGoalTab(emptyGoalRead('unresolved', true))
		expect(screen.getByText(keys.stateGoalsUnresolved)).toBeDefined()
	})

	it('never reads a non-goal breakdown as a scope with no goals', () => {
		renderBreakdowns({ query: emptyGoalRead([]) })
		expect(screen.getByText(keys.stateNoBreakdown)).toBeDefined()
	})
})

describe('Breakdowns header filter', () => {
	const filtered = (onFilterRemove = vi.fn()) =>
		renderBreakdowns({
			filters: [
				{ dimension: 'country', operator: 'eq', value: 'DE' },
				{ dimension: 'page', operator: 'eq', value: '/pricing' },
			],
			onFilterRemove,
		})

	// Where the row was clicked, so a click that collapses the table to one row is explained there.
	it('shows the filter a row click set on this dimension, and only that one', () => {
		const { container } = filtered()
		const head = container.querySelector('.analytics-view__breakdown-head')
		expect(head?.textContent).toContain('/pricing')
		expect(head?.textContent).not.toContain('DE')
	})

	it('clears it from its own button, naming the filter it removes', () => {
		const onFilterRemove = vi.fn()
		filtered(onFilterRemove)
		fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${keys.viewFilterRemove}`) }))
		expect(onFilterRemove).toHaveBeenCalledWith(1)
	})

	it('shows nothing in the header without a filter on this dimension', () => {
		const { container } = renderBreakdowns()
		expect(
			container.querySelector('.analytics-view__breakdown-head .analytics-view__chips')
		).toBeNull()
	})
})

describe('Breakdowns sorted column', () => {
	const shares = (container: HTMLElement): string[] =>
		[...container.querySelectorAll<HTMLElement>('tbody tr')].map((row) =>
			row.style.getPropertyValue('--analytics-bar')
		)
	const emphasis = (container: HTMLElement): string[] =>
		[...container.querySelectorAll('tbody tr:first-child td')].map((cell) => cell.className)

	it('bars and bolds the first column while the rows are ranked by it', () => {
		const { container } = renderBreakdowns()
		expect(shares(container)).toEqual(['100%', '50%'])
		expect(emphasis(container)).toEqual(['analytics-bars__value', 'analytics-bars__secondary'])
	})

	it('moves the bars and the bold figures to the column the rows are sorted by', () => {
		const sortedRows: AnalyticsRow[] = [
			{ dimensions: { page: '/pricing' }, metrics: { pageviews: 120, visitors: 20 } },
			{ dimensions: { page: '/about' }, metrics: { pageviews: 60, visitors: 80 } },
		]
		const { container } = renderBreakdowns({
			order: { metric: 'visitors', direction: 'desc' },
			query: answering(sortedRows),
		})
		expect(shares(container)).toEqual(['25%', '100%'])
		expect(emphasis(container)).toEqual(['analytics-bars__primary', 'analytics-bars__value'])
	})
})

describe('Breakdowns names and ids', () => {
	it('says what a row click does, for the dimension on screen', () => {
		renderBreakdowns()
		const [row] = screen.getAllByRole('button', { name: /\/pricing|\/about/ })
		const hint = document.getElementById(row?.getAttribute('aria-describedby') ?? '')
		expect(hint?.textContent).toBe(keys.viewFilterBy)
	})

	it('heads its region and keeps its ids its own when two are on a page', () => {
		renderBreakdowns()
		renderBreakdowns()
		expect(screen.getAllByRole('region', { name: keys.viewBreakdowns })).toHaveLength(2)
		const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const tab of screen.getAllByRole('tab')) {
			expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).not.toBeNull()
		}
	})
})

describe('Breakdowns before the first answer', () => {
	const rem = (value: string | undefined): number => Number.parseFloat(value ?? '')
	const placeholderRows = (limit: ViewLimit): number =>
		renderBreakdowns({
			limit,
			query: state({ status: 'loading', data: undefined }),
		}).container.querySelectorAll(
			'.analytics-view__skeleton-table--bars > .analytics-view__skeleton'
		).length

	// The answer fills the rows the read asked for, so the placeholder stands that many.
	it('holds a row for every row the read asks for', () => {
		expect(placeholderRows(10)).toBe(10)
		cleanup()
		expect(placeholderRows(25)).toBe(25)
	})

	it('spaces its rows at the pitch of a ranked table, under a head as tall as its own', () => {
		const skeleton = declarationsOf('.analytics-view__skeleton-table')
		expect(skeleton['--analytics-skeleton-row']).toBe(
			declarationsOf('.analytics-bars__track').height
		)
		const cell = declarationsOf('.analytics-table.analytics-bars tbody :is(th, td)')
		expect(rem(skeleton['--analytics-skeleton-gap'])).toBeCloseTo(2 * rem(cell['padding-block']))
		const head = declarationsOf('.analytics-table.analytics-bars thead th')['padding-block']
		expect(skeleton['--analytics-skeleton-head']).toBe(`calc(1lh + ${head?.split(' ')[1]})`)
	})
})
