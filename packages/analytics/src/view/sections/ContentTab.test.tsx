import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { AnalyticsRow, MetricKey } from '../../core/contract'
import type { ItemLabels, QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import type { QueryState } from '../useViewQueries'
import { Breakdowns } from './Breakdowns'

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../../testing/selectMocks')).selectMocks,
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {
	metrics: ['impressions', 'interactions', 'conversions'],
	dimensions: ['item'],
	filters: { item: ['eq'] },
	realtime: false,
	perItemQuery: true,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
} satisfies SerializedCapabilities

const rows: AnalyticsRow[] = [
	{
		dimensions: { item: 'offers:1' },
		metrics: { impressions: 200, interactions: 20, conversions: 4 },
	},
	{
		dimensions: { item: 'offers:2' },
		metrics: { impressions: 50, interactions: 0, conversions: 0 },
	},
]

const read = (itemLabels?: ItemLabels): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	data: {
		result: { rows, meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' } },
		source: { id: 'native', label: 'Native', kind: 'config' },
		capabilities,
		query: {
			metrics: ['impressions', 'interactions', 'conversions'],
			dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
		},
		...(itemLabels ? { itemLabels } : {}),
	},
})

const columns: MetricKey[] = ['impressions', 'interactions', 'conversions']

const renderContent = (
	query: QueryState<QueryResponse>,
	handlers: {
		onRowSelect?: (value: string) => void
		onSortChange?: (order: { metric: MetricKey; direction: 'asc' | 'desc' }) => void
	} = {}
) =>
	render(
		<Breakdowns
			canFilter
			columns={columns}
			countryFlags={false}
			dimension="item"
			dimensions={['item']}
			goals={[]}
			limit={10}
			locale="en"
			onDimensionChange={() => {}}
			onLimitChange={() => {}}
			onRowSelect={handlers.onRowSelect ?? (() => {})}
			onSortChange={handlers.onSortChange ?? (() => {})}
			onTabChange={() => {}}
			query={query}
			tab="content"
			tabs={['pages', 'content']}
		/>
	)

afterEach(() => {
	cleanup()
})

describe('the Content tab', () => {
	it('is a tab of its own, named for what it lists', () => {
		renderContent(read({ 'offers:1': 'Spring sale', 'offers:2': 'Winter sale' }))
		expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
			keys.viewTabPages,
			keys.viewTabContent,
		])
	})

	it('lists each item by its title, with views, clicks, the click rate and conversions', () => {
		const { container } = renderContent(
			read({ 'offers:1': 'Spring sale', 'offers:2': 'Winter sale' })
		)
		const head = container.querySelectorAll('thead th')
		expect([...head].map((cell) => cell.textContent)).toEqual([
			keys.viewDimensionItem,
			METRIC_KEYS.impressions,
			METRIC_KEYS.interactions,
			keys.metricClickRate,
			METRIC_KEYS.conversions,
		])
		const first = container.querySelector('.analytics-bars__row')
		expect(first?.textContent).toContain('Spring sale')
		expect(first?.querySelector('.analytics-bars__value')?.textContent).toBe('200')
		expect(first?.querySelector('.analytics-bars__secondary')?.textContent).toBe('20')
		expect(first?.querySelector('.analytics-bars__tertiary')?.textContent).toBe('10%')
		expect(first?.querySelector('.analytics-bars__quaternary')?.textContent).toBe('4')
	})

	it('never shows a raw ref: a removed or hidden item reads as one', () => {
		const { container } = renderContent(read({ 'offers:1': 'Spring sale', 'offers:2': null }))
		expect(screen.getByText(keys.itemRemoved)).toBeDefined()
		expect(container.textContent).not.toContain('offers:2')
	})

	it('filters by the ref, while showing the title', () => {
		const onRowSelect = vi.fn()
		renderContent(read({ 'offers:1': 'Spring sale', 'offers:2': 'Winter sale' }), { onRowSelect })
		fireEvent.click(screen.getByText('Spring sale'))
		expect(onRowSelect).toHaveBeenCalledWith('offers:1')
	})

	it('sorts by clicks, and by conversions, from their headers', () => {
		const onSortChange = vi.fn()
		renderContent(read({}), { onSortChange })
		fireEvent.click(screen.getByText(METRIC_KEYS.interactions))
		fireEvent.click(screen.getByText(METRIC_KEYS.conversions))
		expect(onSortChange).toHaveBeenNthCalledWith(1, { metric: 'interactions', direction: 'desc' })
		expect(onSortChange).toHaveBeenNthCalledWith(2, { metric: 'conversions', direction: 'desc' })
	})
})
