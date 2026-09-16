import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { AnalyticsRow, DimensionKey } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import type { BreakdownTab } from '../gating'
import { DIMENSION_LABELS, TAB_LABELS } from '../labels'
import type { QueryState } from '../useViewQueries'
import { Breakdowns } from './Breakdowns'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	SelectInput: ({
		label,
		options,
		value,
		onChange,
	}: {
		label?: string
		options?: { value: string; label: string }[]
		value?: string
		onChange?: (option: { value: string; label: string }) => void
	}) => (
		<select
			aria-label={String(label)}
			onChange={(event) => onChange?.({ value: event.target.value, label: event.target.value })}
			value={value}
		>
			{(options ?? []).map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page'],
	filters: ['page'],
	filterOperators: ['eq'],
	realtime: false,
	perPageQuery: false,
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

const ALL_TABS: BreakdownTab[] = ['pages', 'sources', 'technology', 'geography', 'events', 'goals']

const renderBreakdowns = (
	over: {
		tabs?: BreakdownTab[]
		tab?: BreakdownTab
		dimension?: DimensionKey
		dimensions?: DimensionKey[]
		canFilter?: boolean
		query?: QueryState<QueryResponse>
		order?: { metric: 'pageviews' | 'visitors'; direction: 'asc' | 'desc' }
		onTabChange?: (tab: BreakdownTab) => void
		onDimensionChange?: (dimension: DimensionKey) => void
		onLimitChange?: (limit: number) => void
		onSortChange?: (order: { metric: string; direction: 'asc' | 'desc' }) => void
		onRowSelect?: (value: string) => void
	} = {}
) =>
	render(
		<Breakdowns
			canFilter={over.canFilter ?? true}
			dimension={over.dimension ?? 'page'}
			dimensions={over.dimensions ?? ['page']}
			limit={10}
			locale="en"
			metric="pageviews"
			onDimensionChange={over.onDimensionChange ?? (() => {})}
			onLimitChange={over.onLimitChange ?? (() => {})}
			onRowSelect={over.onRowSelect ?? (() => {})}
			onSortChange={over.onSortChange ?? (() => {})}
			onTabChange={over.onTabChange ?? (() => {})}
			{...(over.order ? { order: over.order } : {})}
			query={over.query ?? state()}
			tab={over.tab ?? 'pages'}
			tabs={over.tabs ?? ALL_TABS}
		/>
	)

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
		rerender(
			<Breakdowns
				canFilter={true}
				dimension="page"
				dimensions={['page']}
				limit={10}
				locale="en"
				metric="pageviews"
				onDimensionChange={() => {}}
				onLimitChange={() => {}}
				onRowSelect={() => {}}
				onSortChange={() => {}}
				onTabChange={onTabChange}
				query={state()}
				tab="sources"
				tabs={['pages', 'sources']}
			/>
		)
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
			query: state({
				data: {
					...answer(),
					result: {
						rows: browsers,
						meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' },
					},
				},
			}),
			tab: 'technology',
		})
		expect(document.querySelector('.analytics-view__bars-head-dimension')?.textContent).toBe(
			DIMENSION_LABELS.browser
		)
		fireEvent.click(screen.getByRole('button', { name: /chrome/ }))
		expect(onRowSelect).toHaveBeenCalledWith('chrome')
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

	it('sorts on a column header, and flips the direction on a second click', () => {
		const onSortChange = vi.fn()
		const { rerender } = renderBreakdowns({ onSortChange })
		fireEvent.click(screen.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(onSortChange).toHaveBeenCalledWith({ metric: 'visitors', direction: 'desc' })
		rerender(
			<Breakdowns
				canFilter={true}
				dimension="page"
				dimensions={['page']}
				limit={10}
				locale="en"
				metric="pageviews"
				onDimensionChange={() => {}}
				onLimitChange={() => {}}
				onRowSelect={() => {}}
				onSortChange={onSortChange}
				onTabChange={() => {}}
				order={{ metric: 'visitors', direction: 'desc' }}
				query={state()}
				tab="pages"
				tabs={ALL_TABS}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: new RegExp(METRIC_KEYS.visitors) }))
		expect(onSortChange).toHaveBeenLastCalledWith({ metric: 'visitors', direction: 'asc' })
	})

	it('changes the row limit', () => {
		const onLimitChange = vi.fn()
		renderBreakdowns({ onLimitChange })
		fireEvent.change(screen.getByLabelText(keys.widgetFieldLimit), { target: { value: '50' } })
		expect(onLimitChange).toHaveBeenCalledWith(50)
	})

	it('shows the empty copy when the read came back with no rows', () => {
		const empty = state({
			data: {
				...answer(),
				result: { rows: [], meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' } },
			},
		})
		renderBreakdowns({ query: empty })
		expect(screen.getByText(keys.stateNoBreakdown)).toBeDefined()
	})
})
