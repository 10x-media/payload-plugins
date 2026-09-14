import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsResult } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import type { QueryState } from '../useViewQueries'
import { Trend } from './Trend'

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
