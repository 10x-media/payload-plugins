import { cleanup, render } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsResult } from '../../core/contract'
import type { QueryResponse } from '../../query/response'
import type { QueryState } from '../useViewQueries'
import { comparisonPointsOf, filledSeriesOf, Trend, type TrendProps } from './Trend'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		// biome-ignore lint/a11y/useButtonType: test double
		<button onClick={onClick}>{children}</button>
	),
	ShimmerEffect: ({ className, style }: { className?: string; style?: CSSProperties }) => (
		<div aria-hidden="true" className={className} style={style} />
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

const answeredWith = (data: QueryResponse): QueryState<QueryResponse> => ({
	status: 'ok',
	isRefetching: false,
	refetch: () => {},
	data,
})

const query = (compare: boolean): QueryState<QueryResponse> =>
	answeredWith({
		result: result([4, 8, 2]),
		...(compare ? { comparison: result([1, 3, 9]) } : {}),
	} as QueryResponse)

const renderTrend = (over: Partial<TrendProps> & Pick<TrendProps, 'query'>) =>
	render(
		<Trend
			compare={false}
			granularity="day"
			locale="en"
			metric="pageviews"
			rangeCaption="Jun 1 - Jun 3"
			timezone="UTC"
			{...over}
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
		const { container } = renderTrend({ compare: true, query: query(true) })
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(1)
		const legend = container.querySelector('.analytics-chart__legend')
		expect(legend?.textContent).toContain('analytics:viewTrendPrevious')
	})

	// A source can serve the metric as a range total and nothing per bucket (Umami answers
	// conversions only as goal rows and a range total); a zeroed line would read as a real zero.
	it('shows the empty state when no bucket carries the selected metric', () => {
		const { container } = renderTrend({ metric: 'conversions', query: query(false) })
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(0)
		expect(container.querySelector('.analytics-view__empty')?.textContent).toBe(
			'analytics:stateNoData'
		)
	})

	it('draws no legend without a comparison', () => {
		const { container } = renderTrend({ query: query(false) })
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(1)
		expect(container.querySelector('.analytics-chart__legend')).toBeNull()
	})

	const averages = (values: Array<number | null>): QueryState<QueryResponse> =>
		answeredWith({
			result: {
				rows: values.map((value, i) => ({
					timestamp: `2026-06-0${i + 1}T00:00:00.000Z`,
					metrics: { avgDuration: value },
				})),
				meta: { provider: 'native', fetchedAt: '2026-06-03T00:00:00.000Z' },
			},
		} as QueryResponse)

	const renderAverages = (values: Array<number | null>) =>
		renderTrend({ metric: 'avgDuration', query: averages(values) })

	// A day nobody visited has no average time, so the line breaks there instead of dropping
	// to a zero-second visit.
	it('breaks the line at a day without a reading', () => {
		const { container } = renderAverages([4000, null, 6000])
		expect(container.querySelectorAll('.analytics-chart__dot')).toHaveLength(2)
	})

	it('shows the empty state when no day has a reading', () => {
		const { container } = renderAverages([null, null, null])
		expect(container.querySelectorAll('.analytics-chart')).toHaveLength(0)
		expect(container.querySelector('.analytics-view__empty')?.textContent).toBe(
			'analytics:stateNoData'
		)
	})
})

describe('Trend section, the bucket still counting', () => {
	const today = (now: string): QueryState<QueryResponse> =>
		answeredWith({
			result: {
				rows: [
					{ timestamp: '2026-10-07T00:00:00.000Z', metrics: { pageviews: 9 } },
					{ timestamp: '2026-10-08T00:00:00.000Z', metrics: { pageviews: 2 } },
				],
				totals: { pageviews: 11 },
				meta: { provider: 'native', fetchedAt: now },
			},
			query: {
				metrics: ['pageviews'],
				dateRange: { start: '2026-10-07T00:00:00.000Z', end: '2026-10-08T23:59:59.999Z' },
				timezone: 'UTC',
			},
		} as QueryResponse)

	const periods = (container: HTMLElement): Array<string | null> =>
		[...container.querySelectorAll('.analytics-chart__table tbody th')].map(
			(cell) => cell.textContent
		)

	// "Last N days" includes today: its line would plunge as if nobody came, unmarked.
	it('dashes the line into today and names it "so far", the totals untouched', () => {
		const { container } = renderTrend({
			now: new Date('2026-10-08T15:00:00.000Z'),
			query: today('2026-10-08T15:00:00.000Z'),
			rangeCaption: 'Oct 7 - Oct 8',
		})
		expect(container.querySelector('.analytics-chart__line--partial')).not.toBeNull()
		expect(periods(container).at(-1)).toContain('analytics:chartSoFar')
		expect(periods(container)[0]).not.toContain('analytics:chartSoFar')
		const values = [...container.querySelectorAll('.analytics-chart__table tbody td')].map(
			(cell) => cell.textContent
		)
		expect(values).toEqual(['9', '2'])
	})

	it('marks nothing once the range is over', () => {
		const { container } = renderTrend({
			now: new Date('2026-10-12T09:00:00.000Z'),
			query: today('2026-10-12T09:00:00.000Z'),
			rangeCaption: 'Oct 7 - Oct 8',
		})
		expect(container.querySelector('.analytics-chart__line--partial')).toBeNull()
		expect(periods(container).some((period) => period?.includes('analytics:chartSoFar'))).toBe(
			false
		)
	})
})

const ticksOf = (container: HTMLElement): Array<string | null> =>
	[...container.querySelectorAll('.analytics-chart__tick')].map((tick) => tick.textContent)

describe('Trend section, the axis', () => {
	// 12:20 AM in Los Angeles: an hour read, which alone would stretch across the whole plot.
	it('draws today just after midnight as one hour at the start of a whole day', () => {
		const { container } = renderTrend({
			granularity: 'hour',
			now: new Date('2026-10-09T07:20:00.000Z'),
			query: answeredWith({
				result: {
					rows: [{ timestamp: '2026-10-09T07:00:00.000Z', metrics: { pageviews: 9 } }],
					totals: { pageviews: 9 },
					meta: { provider: 'native', fetchedAt: '2026-10-09T07:20:00.000Z' },
				},
				query: {
					metrics: ['pageviews'],
					dateRange: { start: '2026-10-09T07:00:00.000Z', end: '2026-10-10T06:59:59.999Z' },
					timezone: 'America/Los_Angeles',
				},
			} as QueryResponse),
			rangeCaption: 'Oct 9, 2026',
			timezone: 'America/Los_Angeles',
		})
		expect(ticksOf(container)[0]).toBe('12 AM')
		expect(ticksOf(container).at(-1)).toBe('11 PM')
		const dots = [...container.querySelectorAll<HTMLElement>('.analytics-chart__dot')]
		expect(dots.map((dot) => dot.style.getPropertyValue('--analytics-x'))).toEqual(['0%'])
		const rows = [...container.querySelectorAll('.analytics-chart__table tbody th')]
		expect(rows.map((row) => row.textContent)).toEqual(['analytics:chartSoFar'])
	})

	// This year by week: its first week opens on Monday, December 29, outside the range.
	it('names the first week by the day the range starts, not the Monday before it', () => {
		const { container } = renderTrend({
			granularity: 'week',
			query: answeredWith({
				result: {
					rows: [{ timestamp: '2026-01-05T00:00:00.000Z', metrics: { pageviews: 3 } }],
					totals: { pageviews: 3 },
					meta: { provider: 'native', fetchedAt: '2026-01-20T12:00:00.000Z' },
				},
				query: {
					metrics: ['pageviews'],
					dateRange: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-20T23:59:59.999Z' },
					timezone: 'UTC',
				},
			} as QueryResponse),
			rangeCaption: 'Jan 1 - 20, 2026',
		})
		expect(ticksOf(container)).toEqual(['Jan 1', 'Jan 5', 'Jan 12', 'Jan 19'])
	})
})

describe('Trend section, before the first answer', () => {
	// The placeholder stands as tall as the chart and its caption, so the answer moves nothing.
	it('holds the plot at the height of the chart, its caption under it', () => {
		const loading: QueryState<QueryResponse> = {
			status: 'loading',
			isRefetching: false,
			refetch: () => {},
		}
		const props = {
			compare: false,
			granularity: 'day',
			locale: 'en',
			metric: 'pageviews',
			rangeCaption: 'Jun 1 - Jun 3',
			timezone: 'UTC',
		} as const
		const { container, rerender } = render(<Trend {...props} query={loading} />)
		const shimmer = container.querySelector<HTMLElement>('.analytics-view__skeleton--chart')
		const held = shimmer?.style.getPropertyValue('--analytics-chart-height')
		expect(held).toBe('200px')
		expect(container.querySelector('.analytics-view__caption')?.textContent).toMatch(
			/^Jun 1 - Jun 3 · /
		)
		rerender(<Trend {...props} query={query(false)} />)
		const chart = container.querySelector<HTMLElement>('.analytics-chart')
		expect(chart?.style.getPropertyValue('--analytics-chart-height')).toBe(held)
		expect(container.querySelector('.analytics-view__caption')?.textContent).toMatch(
			/^Jun 1 - Jun 3 · /
		)
	})
})

describe('filledSeriesOf', () => {
	/** What the endpoint answers: the rows it read and the window it read them for. */
	const answered = (args: {
		rows: Array<[string, number]>
		start: string
		end: string
		timezone: string
		comparison?: Array<[string, number]>
	}): QueryResponse =>
		({
			result: {
				rows: args.rows.map(([timestamp, pageviews]) => ({ timestamp, metrics: { pageviews } })),
				meta: { provider: 'native', fetchedAt: args.end },
			},
			...(args.comparison
				? {
						comparison: {
							rows: args.comparison.map(([timestamp, pageviews]) => ({
								timestamp,
								metrics: { pageviews },
							})),
							meta: { provider: 'native', fetchedAt: args.start },
						},
					}
				: {}),
			query: {
				metrics: ['pageviews'],
				dateRange: { start: args.start, end: args.end },
				timezone: args.timezone,
			},
		}) as QueryResponse

	// The 30 days the reader picked, Sep 9 to Oct 8 in New York: a row filed before the range must
	// not open the chart, and a day nobody visited still has its place on the axis.
	it('draws every day of the range and nothing outside it', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [
					['2026-09-08T04:00:00.000Z', 41],
					['2026-09-09T04:00:00.000Z', 10],
					['2026-10-08T04:00:00.000Z', 5],
				],
				start: '2026-09-09T04:00:00.000Z',
				end: '2026-10-09T03:59:59.999Z',
				timezone: 'America/New_York',
			}),
			metric: 'pageviews',
			granularity: 'day',
			timezone: 'America/New_York',
		})
		expect(filled?.points).toHaveLength(30)
		expect(filled?.points[0]).toEqual({ date: '2026-09-09T04:00:00.000Z', value: 10 })
		expect(filled?.points.at(-1)).toEqual({ date: '2026-10-08T04:00:00.000Z', value: 5 })
		expect(filled?.points[1]?.value).toBe(0)
		expect(filled?.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(15)
	})

	// Today by hour: the hours nobody visited are on the axis, the ones still to come are not.
	it('keeps the empty hours of today and stops at the current one', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [['2026-10-08T08:00:00.000Z', 3]],
				start: '2026-10-08T07:00:00.000Z',
				end: '2026-10-09T06:59:59.999Z',
				timezone: 'America/Los_Angeles',
			}),
			metric: 'pageviews',
			granularity: 'hour',
			timezone: 'America/Los_Angeles',
			now: new Date('2026-10-08T12:30:00.000Z'),
		})
		expect(filled?.points.map((point) => point.value)).toEqual([0, 3, 0, 0, 0, 0])
		expect(filled?.points.at(-1)?.date).toBe('2026-10-08T12:00:00.000Z')
	})

	it('lays the previous window under the current one, bucket by bucket', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [['2026-10-07T00:00:00.000Z', 2]],
				start: '2026-10-06T00:00:00.000Z',
				end: '2026-10-08T23:59:59.999Z',
				timezone: 'UTC',
				comparison: [['2026-10-03T00:00:00.000Z', 7]],
			}),
			metric: 'pageviews',
			granularity: 'day',
			timezone: 'UTC',
		})
		expect(filled?.points.map((point) => point.value)).toEqual([0, 2, 0])
		expect(filled?.previous.map((point) => point.value)).toEqual([7, 0, 0])
	})

	// The last twelve months by month: every month on the axis, the quiet ones at zero.
	it('fills a year of months', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [['2026-08-01T00:00:00.000Z', 9]],
				start: '2025-10-09T00:00:00.000Z',
				end: '2026-10-08T23:59:59.999Z',
				timezone: 'UTC',
			}),
			metric: 'pageviews',
			granularity: 'month',
			timezone: 'UTC',
		})
		expect(filled?.points).toHaveLength(13)
		expect(filled?.points[0]?.date).toBe('2025-10-01T00:00:00.000Z')
		expect(filled?.points.find((point) => point.value === 9)?.date).toBe('2026-08-01T00:00:00.000Z')
	})

	// 90 days by week: every week the window touches, from the one holding its first day.
	it('fills the weeks of a quarter', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [['2026-09-28T00:00:00.000Z', 4]],
				start: '2026-07-11T00:00:00.000Z',
				end: '2026-10-08T23:59:59.999Z',
				timezone: 'UTC',
			}),
			metric: 'pageviews',
			granularity: 'week',
			timezone: 'UTC',
		})
		expect(filled?.points[0]?.date).toBe('2026-07-06T00:00:00.000Z')
		expect(filled?.points.at(-1)?.date).toBe('2026-10-05T00:00:00.000Z')
		expect(filled?.points).toHaveLength(14)
		expect(filled?.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(4)
	})

	// A week picked by hour is the reader's choice: every hour is drawn, not the widgets' last 60.
	it('draws every hour of a week grouped by hour', () => {
		const filled = filledSeriesOf({
			data: answered({
				rows: [['2026-10-01T00:00:00.000Z', 1]],
				start: '2026-10-01T00:00:00.000Z',
				end: '2026-10-07T23:59:59.999Z',
				timezone: 'UTC',
			}),
			metric: 'pageviews',
			granularity: 'hour',
			timezone: 'UTC',
		})
		expect(filled?.points).toHaveLength(7 * 24)
		expect(filled?.points[0]).toEqual({ date: '2026-10-01T00:00:00.000Z', value: 1 })
	})

	it('leaves an answer naming no window, and a minute series, to its own rows', () => {
		expect(
			filledSeriesOf({
				data: query(false).data,
				metric: 'pageviews',
				granularity: 'day',
				timezone: 'UTC',
			})
		).toBeNull()
		expect(
			filledSeriesOf({
				data: answered({
					rows: [],
					start: '2026-10-08T00:00:00.000Z',
					end: '2026-10-08T01:00:00.000Z',
					timezone: 'UTC',
				}),
				metric: 'pageviews',
				granularity: 'minute',
				timezone: 'UTC',
			})
		).toBeNull()
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
