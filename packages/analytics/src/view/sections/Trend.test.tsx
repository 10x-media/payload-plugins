import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsResult } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import type { QueryState } from '../useViewQueries'
import { comparisonPointsOf, Trend } from './Trend'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const result = (values: number[]): AnalyticsResult => ({
	rows: values.map((value, i) => ({
		timestamp: `2026-06-0${i + 1}T00:00:00.000Z`,
		metrics: { pageviews: value },
	})),
	totals: { pageviews: values.reduce((a, b) => a + b, 0) },
	meta: { provider: 'native', fetchedAt: '2026-06-03T00:00:00.000Z' },
})

const query = (compare: boolean): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	data: {
		result: result([4, 8, 2]),
		...(compare ? { comparison: result([1, 3, 9]) } : {}),
	} as QueryResponse,
})

const renderTrend = (compare: boolean) =>
	render(
		<Trend
			compare={compare}
			granularity="day"
			locale="en"
			metric="pageviews"
			query={query(compare)}
			rangeCaption="Jun 1 - Jun 3"
			timezone="UTC"
		/>
	)

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('Trend section', () => {
	it('draws one chart with the previous period overlaid', () => {
		const { container } = renderTrend(true)
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(1)
		const legend = container.querySelector('.analytics-chart__legend')
		expect(legend?.textContent).toContain('analytics:viewTrendPrevious')
	})

	it('draws no legend without a comparison', () => {
		const { container } = renderTrend(false)
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(1)
		expect(container.querySelector('.analytics-chart__legend')).toBeNull()
	})
})

describe('comparisonPointsOf', () => {
	const bucket = { granularity: 'month' as const, locale: 'en', timezone: 'UTC' }

	/** Monthly rows, so the two windows can land on different boundary counts. */
	const monthly = (count: number, from: number): AnalyticsResult => ({
		rows: Array.from({ length: count }, (_, i) => ({
			timestamp: new Date(Date.UTC(2025, from + i, 1)).toISOString(),
			metrics: { pageviews: i + 1 },
		})),
		totals: { pageviews: count },
		meta: { provider: 'native', fetchedAt: '2026-06-03T00:00:00.000Z' },
	})

	it('keeps the primary axis when the comparison comes back a bucket longer', () => {
		const primary = monthly(13, 0)
		const points = comparisonPointsOf({
			comparison: monthly(14, 0),
			primary,
			metric: 'pageviews',
			bucket,
		})
		expect(points).toHaveLength(13)
		expect(points.map((p) => p.label)).toEqual(
			primary.rows.map((_, i) =>
				new Intl.DateTimeFormat('en', {
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC',
				}).format(new Date(Date.UTC(2025, i, 1)))
			)
		)
		// The 14th previous-window bucket has no current bucket to sit under and is dropped.
		expect(points.at(-1)?.value).toBe(13)
	})

	it('zero-fills the tail when the comparison comes back a bucket shorter', () => {
		const points = comparisonPointsOf({
			comparison: monthly(13, 0),
			primary: monthly(14, 0),
			metric: 'pageviews',
			bucket,
		})
		expect(points).toHaveLength(14)
		expect(points.at(-1)?.value).toBe(0)
	})

	it('returns nothing when there is no comparison at all', () => {
		expect(
			comparisonPointsOf({
				comparison: undefined,
				primary: monthly(3, 0),
				metric: 'pageviews',
				bucket,
			})
		).toEqual([])
	})
})
