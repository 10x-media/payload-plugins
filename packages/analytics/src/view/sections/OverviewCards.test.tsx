import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import type { MetricKey } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import { METRIC_KEYS } from '../../translations/metricKeys'
import type { QueryState } from '../useViewQueries'
import { OverviewCards } from './OverviewCards'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
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
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
} as unknown as SerializedCapabilities

const answer = (
	totals: Partial<Record<MetricKey, number>>,
	comparison?: Partial<Record<MetricKey, number>>
): QueryResponse => ({
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

afterEach(() => {
	cleanup()
})

describe('OverviewCards', () => {
	it('renders one card per served metric with the formatted total', () => {
		render(
			<OverviewCards
				compare={false}
				locale="en"
				metrics={metrics}
				onSelect={() => {}}
				query={state({ data: answer({ pageviews: 1234, visitors: 400 }) })}
				selected="pageviews"
			/>
		)
		expect(screen.getAllByRole('button')).toHaveLength(2)
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByText(METRIC_KEYS.visitors)).toBeDefined()
	})

	it('marks the charted metric and selects another on click', () => {
		const onSelect = vi.fn()
		render(
			<OverviewCards
				compare={false}
				locale="en"
				metrics={metrics}
				onSelect={onSelect}
				query={state({ data: answer({ pageviews: 10, visitors: 4 }) })}
				selected="pageviews"
			/>
		)
		const [pageviews, visitors] = screen.getAllByRole('button')
		expect(pageviews?.getAttribute('aria-pressed')).toBe('true')
		expect(visitors?.getAttribute('aria-pressed')).toBe('false')
		fireEvent.click(visitors as HTMLElement)
		expect(onSelect).toHaveBeenCalledWith('visitors')
	})

	it('shows skeletons while the first read is in flight', () => {
		const { container } = render(
			<OverviewCards
				compare={false}
				locale="en"
				metrics={metrics}
				onSelect={() => {}}
				query={state({ status: 'loading' })}
				selected="pageviews"
			/>
		)
		expect(container.querySelectorAll('.analytics-view__skeleton').length).toBeGreaterThan(0)
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('keeps the rendered totals while the next read is in flight', () => {
		render(
			<OverviewCards
				compare={false}
				locale="en"
				metrics={metrics}
				onSelect={() => {}}
				query={state({
					status: 'loading',
					isRefetching: true,
					data: answer({ pageviews: 1234, visitors: 400 }),
				})}
				selected="pageviews"
			/>
		)
		expect(screen.getByText('1,234')).toBeDefined()
		expect(screen.getByRole('group').getAttribute('aria-busy')).toBe('true')
	})

	it('renders the period delta when comparing', () => {
		render(
			<OverviewCards
				compare={true}
				locale="en"
				metrics={metrics}
				onSelect={() => {}}
				query={state({ data: answer({ pageviews: 120 }, { pageviews: 100 }) })}
				selected="pageviews"
			/>
		)
		expect(screen.getByText('20%')).toBeDefined()
	})

	it('leaves the delta out when the read carries no comparison', () => {
		render(
			<OverviewCards
				compare={true}
				locale="en"
				metrics={metrics}
				onSelect={() => {}}
				query={state({ data: answer({ pageviews: 120 }) })}
				selected="pageviews"
			/>
		)
		expect(screen.queryByText('20%')).toBeNull()
	})
})
