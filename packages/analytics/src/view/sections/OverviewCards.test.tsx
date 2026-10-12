import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { MetricKey, MetricValues } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import { declarationsOf } from '../../testing/stylesheet'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import type { QueryState } from '../useViewQueries'
import { OverviewCards } from './OverviewCards'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Pill: ({ children, className }: { children?: ReactNode; className?: string }) => (
		<span className={className}>{children}</span>
	),
	ShimmerEffect: ({ className }: { className?: string }) => (
		<div aria-hidden="true" className={className} />
	),
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const capabilities = {
	metrics: ['pageviews', 'visitors'],
	dimensions: ['page'],
	filters: { page: ['eq'] },
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
} as unknown as SerializedCapabilities

const answer = (totals: MetricValues, comparison?: MetricValues): QueryResponse => ({
	result: { rows: [], totals, meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' } },
	...(comparison
		? {
				comparison: {
					rows: [],
					totals: comparison,
					meta: { provider: 'native', fetchedAt: '2026-09-14T00:00:00.000Z' },
				},
			}
		: {}),
	source: { id: 'native', label: 'Native', kind: 'config' },
	capabilities,
	query: {
		metrics: ['pageviews'],
		dateRange: { start: '2026-08-16T00:00:00.000Z', end: '2026-09-14T00:00:00.000Z' },
	},
})

const state = (over: Partial<QueryState<QueryResponse>>): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	...over,
})

const metrics: MetricKey[] = ['pageviews', 'visitors']

const renderCards = (over: {
	query: QueryState<QueryResponse>
	compare?: boolean
	metrics?: MetricKey[]
	onSelect?: (metric: MetricKey) => void
}) =>
	render(
		<OverviewCards
			compare={over.compare ?? false}
			locale="en"
			metrics={over.metrics ?? metrics}
			onSelect={over.onSelect ?? (() => {})}
			query={over.query}
			selected="pageviews"
		/>
	)

afterEach(() => {
	cleanup()
})

describe('OverviewCards', () => {
	it('names visitors added up day by day for what they are, and distinct ones plainly', () => {
		const summed = answer({ pageviews: 1234, visitors: 400 })
		summed.result.meta.visitorsAre = 'sumOfDaily'
		renderCards({ query: state({ data: summed }) })
		expect(screen.getByText(keys.metricVisitorsSummed)).toBeDefined()
		cleanup()
		const distinct = answer({ pageviews: 1234, visitors: 400 })
		distinct.result.meta.visitorsAre = 'distinct'
		renderCards({ query: state({ data: distinct }) })
		expect(screen.getByText(METRIC_KEYS.visitors)).toBeDefined()
		expect(screen.queryByText(keys.metricVisitorsSummed)).toBeNull()
	})

	it('renders one card per served metric with the formatted total', () => {
		renderCards({ query: state({ data: answer({ pageviews: 1234, visitors: 400 }) }) })
		expect(screen.getAllByRole('button')).toHaveLength(2)
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByText(METRIC_KEYS.visitors)).toBeDefined()
	})

	it('marks the charted metric and selects another on click', () => {
		const onSelect = vi.fn()
		renderCards({ onSelect, query: state({ data: answer({ pageviews: 10, visitors: 4 }) }) })
		const [pageviews, visitors] = screen.getAllByRole('button')
		expect(pageviews?.getAttribute('aria-pressed')).toBe('true')
		expect(visitors?.getAttribute('aria-pressed')).toBe('false')
		fireEvent.click(visitors as HTMLElement)
		expect(onSelect).toHaveBeenCalledWith('visitors')
	})

	it('shows skeletons while the first read is in flight', () => {
		const { container } = renderCards({ query: state({ status: 'loading' }) })
		expect(container.querySelectorAll('.analytics-view__skeleton').length).toBeGreaterThan(0)
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('keeps the rendered totals while the next read is in flight', () => {
		renderCards({
			query: state({
				status: 'loading',
				isRefetching: true,
				data: answer({ pageviews: 1234, visitors: 400 }),
			}),
		})
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByRole('group').getAttribute('aria-busy')).toBe('true')
	})

	it('renders the period delta when comparing', () => {
		renderCards({
			compare: true,
			query: state({ data: answer({ pageviews: 120 }, { pageviews: 100 }) }),
		})
		expect(screen.getByText('20%')).toBeDefined()
	})

	// "0s" would read as a measured zero-second visit; an average of nothing is no data.
	it('shows a dash and no delta for an average with no samples', () => {
		const { container } = renderCards({
			compare: true,
			metrics: ['pageviews', 'avgDuration'],
			query: state({
				data: answer({ pageviews: 0, avgDuration: null }, { pageviews: 0, avgDuration: 3000 }),
			}),
		})
		const [, average] = screen.getAllByRole('button')
		const value = average?.querySelector('.analytics-metric__value')
		expect(value?.querySelector('[aria-hidden="true"]')?.textContent).toBe('-')
		expect(value?.querySelector('.analytics-sr-only')?.textContent).toBe(keys.stateNoValue)
		expect(average?.querySelector('[role="img"]')).toBeNull()
		expect(container.textContent).not.toContain('0s')
	})

	it('leaves the delta out when the read carries no comparison', () => {
		renderCards({ compare: true, query: state({ data: answer({ pageviews: 120 }) }) })
		expect(screen.queryByText('20%')).toBeNull()
	})
})

describe('OverviewCards before the first answer', () => {
	const placeholders = (compare: boolean) =>
		renderCards({ compare, query: state({ status: 'loading' }) }).container.querySelectorAll(
			'.analytics-view__cards > .analytics-card.analytics-view__card'
		)

	const parts = (card: Element | undefined): string[] =>
		[...(card?.children ?? [])].map((part) =>
			[...part.classList].filter((name) => name.startsWith('analytics-view__skeleton--')).join()
		)

	// The answer lands in cards of the same count, chrome and lines, so the page below stays put.
	it('stands a card in for each metric, a block per line the card will hold', () => {
		const cards = placeholders(false)
		expect(cards).toHaveLength(metrics.length)
		expect(cards[0]?.classList.contains('analytics-metric')).toBe(true)
		expect(cards[0]?.getAttribute('aria-hidden')).toBe('true')
		expect(parts(cards[0])).toEqual([
			'analytics-view__skeleton--label',
			'analytics-view__skeleton--value',
		])
	})

	it('holds the line of the comparison while the view compares', () => {
		expect(parts(placeholders(true)[1])).toEqual([
			'analytics-view__skeleton--label',
			'analytics-view__skeleton--value',
			'analytics-view__skeleton--delta',
		])
	})

	it('sizes each block as the line it stands in for', () => {
		const label = declarationsOf('.analytics-view__skeleton--label')
		expect(label['margin-block']).toBe(`calc((1lh - ${label.height}) / 2)`)
		const number = declarationsOf('.analytics-view__card .analytics-metric__value')['font-size']
		const leading = declarationsOf('.analytics-metric__value')['line-height']
		expect(declarationsOf('.analytics-view__skeleton--value').height).toBe(
			`calc(${number} * ${leading})`
		)
		expect(declarationsOf('.analytics-view__skeleton--delta').height).toBe(
			declarationsOf('.analytics-delta__change')['line-height']
		)
	})
})
