'use client'

import { type ReactNode, useId } from 'react'
import { bucketLabel, bucketTooltipLabel, upcomingHours } from '../../charts/bucket'
import { markInProgress } from '../../charts/inProgress'
import { alignSeries, fillSeries, isSeriesGranularity, type SeriesPoint } from '../../charts/series'
import { TrendChart, type TrendPoint } from '../../charts/TrendChart'
import type {
	AnalyticsResult,
	DateRange,
	Granularity,
	MetricKey,
	MetricValue,
} from '../../core/contract'
import { readingOf } from '../../core/metricValues'
import { formatMetricValue } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { previousWindow } from '../../timeframe/comparison'
import { keys } from '../../translations/keys'
import { metricLabelKey } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { Card } from '../../ui/components/Card'
import { GRANULARITY_LABELS } from '../labels'
import type { QueryState } from '../useViewQueries'
import { QueryError, SectionEmpty, Skeleton } from './EmptyStates'

export interface TrendProps {
	query: QueryState<QueryResponse>
	metric: MetricKey
	/** The bucket the read was requested at; the rows arrive already aggregated to it. */
	granularity: Granularity
	compare: boolean
	locale: string
	/** ISO 4217 code revenue renders in; absent leaves it a plain number. */
	currency?: string
	timezone: string
	rangeCaption: string
	/**
	 * The view's clock. Buckets after it hold nothing yet: today's line ends at the current hour
	 * rather than running on at zero, and the hours to midnight stay on the axis, empty.
	 */
	now?: Date
}

/** The plot's height, which the placeholder keeps while the first read is in flight. */
const PLOT_HEIGHT = 200

interface BucketArgs {
	granularity: Granularity
	locale: string
	currency?: string
	timezone: string
	/** The read window's start, which names a first bucket that begins before it. */
	from?: Date
}

/**
 * The endpoint already returns the read's buckets, so labels come straight from row timestamps
 * with nothing folded. A month on the view's axis always names its year.
 */
const labelFor = (
	timestamp: string | undefined,
	{ granularity, locale, timezone, from }: BucketArgs
): string => {
	if (timestamp === undefined) {
		return ''
	}
	const at = new Date(timestamp)
	return Number.isNaN(at.getTime())
		? timestamp
		: bucketLabel(at, { granularity, locale, tz: timezone, ...(from ? { from } : {}) }, true)
}

const tooltipLabelFor = (
	timestamp: string | undefined,
	{ granularity, locale, timezone }: BucketArgs
): string | undefined => {
	if (timestamp === undefined) {
		return undefined
	}
	const at = new Date(timestamp)
	return Number.isNaN(at.getTime())
		? undefined
		: bucketTooltipLabel(at, { granularity, locale, tz: timezone })
}

/**
 * A source may serve a metric only as a range total (Umami's conversions), and its empty buckets
 * would draw a flat zero line that reads as "nobody converted".
 */
const carriesMetric = (result: AnalyticsResult | undefined, metric: MetricKey): boolean =>
	(result?.rows ?? []).some((row) => row.metrics[metric] !== undefined)

const trendPoint = (
	{ at, value }: { at: string | undefined; value: MetricValue },
	metric: MetricKey,
	bucket: BucketArgs
): TrendPoint => {
	const tooltipLabel = tooltipLabelFor(at, bucket)
	return {
		at: at ?? '',
		label: labelFor(at, bucket),
		...(tooltipLabel === undefined ? {} : { tooltipLabel }),
		value,
		display: formatMetricValue(metric, value, {
			locale: bucket.locale,
			currency: bucket.currency,
		}),
	}
}

const pointsOf = (
	result: AnalyticsResult | undefined,
	metric: MetricKey,
	bucket: BucketArgs
): TrendPoint[] =>
	(result?.rows ?? []).map((row) =>
		trendPoint({ at: row.timestamp, value: readingOf(row.metrics, metric) }, metric, bucket)
	)

/** The window the endpoint read, as it answered it; null for an answer that names none. */
const readWindowOf = (data: QueryResponse): DateRange | null => {
	const start = new Date(data.query?.dateRange.start ?? '')
	const end = new Date(data.query?.dateRange.end ?? '')
	return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end }
}

/**
 * Charted series on a gapless axis of the read window up to `now`, comparison filled over its own
 * window and laid under it. Null without an axis: no window named, or a bucket under an hour.
 */
export const filledSeriesOf = (args: {
	data: QueryResponse | undefined
	metric: MetricKey
	granularity: Granularity
	timezone: string
	now?: Date
}): { points: SeriesPoint[]; previous: SeriesPoint[] } | null => {
	const { data, metric, granularity } = args
	const window = data ? readWindowOf(data) : null
	if (!data || !window || !isSeriesGranularity(granularity)) {
		return null
	}
	const tz = data.query.timezone ?? args.timezone
	const { now } = args
	const end =
		now !== undefined && now < window.end ? (now < window.start ? window.start : now) : window.end
	const points = fillSeries({
		rows: data.result.rows,
		dateRange: { start: window.start, end },
		metric,
		tz,
		granularity,
		uncapped: true,
	})
	const comparisonWindow = data.comparison ? previousWindow(window, tz) : null
	const previous =
		data.comparison && comparisonWindow
			? alignSeries(
					fillSeries({
						rows: data.comparison.rows,
						dateRange: comparisonWindow,
						metric,
						tz,
						granularity,
						uncapped: true,
					}),
					points,
					metric
				)
			: []
	return { points, previous }
}

/**
 * Comparison re-dated onto primary timestamps by index: week and month buckets can differ in count
 * per window. Exported for its own test, since a length mismatch never shows on the chart.
 */
export const comparisonPointsOf = ({
	comparison,
	primary,
	metric,
	bucket,
}: {
	comparison: AnalyticsResult | undefined
	primary: AnalyticsResult | undefined
	metric: MetricKey
	bucket: BucketArgs
}): TrendPoint[] => {
	const rows = comparison?.rows ?? []
	if (rows.length === 0) {
		return []
	}
	return (primary?.rows ?? []).map((row, i) =>
		trendPoint({ at: row.timestamp, value: readingOf(rows[i]?.metrics, metric) }, metric, bucket)
	)
}

/**
 * The charted metric over the window, with the comparison period overlaid on the same axes
 * when the view asked for one, and the bucket still counting marked as such.
 */
export function Trend({
	query,
	metric,
	granularity,
	compare,
	locale,
	currency,
	timezone,
	rangeCaption,
	now,
}: TrendProps) {
	const { t } = useTranslation()
	const headingId = useId()
	// A week or a month of daily visitors is their sum; a day or an hour is counted as it is.
	const summed =
		(granularity === 'week' || granularity === 'month') &&
		query.data?.result.meta.visitorsAre === 'sumOfDaily'
	const title = t(metricLabelKey(metric, summed))
	const caption = `${rangeCaption} · ${t(GRANULARITY_LABELS[granularity])}`
	const read = query.data ? readWindowOf(query.data) : null
	const bucket: BucketArgs = {
		granularity,
		locale,
		timezone,
		...(currency ? { currency } : {}),
		...(read ? { from: read.start } : {}),
	}
	const charted = carriesMetric(query.data?.result, metric)
	const filled = filledSeriesOf({
		data: query.data,
		metric,
		granularity,
		timezone,
		...(now === undefined ? {} : { now }),
	})
	const answered = filled
		? filled.points.map((point) =>
				trendPoint({ at: point.date, value: point.value }, metric, bucket)
			)
		: pointsOf(query.data?.result, metric, bucket)
	const reached = charted ? answered : []
	const lastReached = reached.at(-1)?.at
	const upcoming: TrendPoint[] =
		filled && granularity === 'hour' && lastReached
			? upcomingHours(new Date(lastReached), {
					granularity,
					locale,
					tz: query.data?.query?.timezone ?? timezone,
				}).map((hour) => ({
					...hour,
					display: formatMetricValue(metric, hour.value, { locale, currency }),
				}))
			: []
	const drawn = [...reached, ...upcoming]
	const points =
		now !== undefined && read !== null
			? markInProgress(drawn, {
					now,
					end: read.end,
					soFar: (period) => t(keys.chartSoFar, { period }),
				})
			: drawn
	const comparison = filled
		? filled.previous.map((point, i) =>
				trendPoint({ at: filled.points[i]?.date, value: point.value }, metric, bucket)
			)
		: comparisonPointsOf({
				comparison: query.data?.comparison,
				primary: query.data?.result,
				metric,
				bucket,
			})
	const previous = compare ? comparison : []

	const body = (): ReactNode => {
		if (query.data === undefined) {
			return query.status === 'error' ? null : (
				<>
					<Skeleton height={PLOT_HEIGHT} rows={1} variant="chart" />
					<span className="analytics-view__caption">{caption}</span>
				</>
			)
		}
		// No bucket has a reading, which an empty plot would only dress up as a chart.
		if (points.every((point) => point.value === null)) {
			return <SectionEmpty />
		}
		return (
			<>
				<TrendChart
					ariaLabel={`${title} ${caption}`}
					buckets={points}
					{...(previous.length > 0
						? { comparison: previous, comparisonLabel: t(keys.viewTrendPrevious) }
						: {})}
					keyboardHint={t(keys.chartKeyboardHint)}
					label={title}
					minHeight={PLOT_HEIGHT}
					noValueLabel={t(keys.stateNoValue)}
					periodLabel={t(keys.viewTrendPeriod)}
				/>
				<span className="analytics-view__caption">{caption}</span>
			</>
		)
	}

	return (
		<Card
			aria-busy={query.isRefetching}
			aria-labelledby={headingId}
			as="section"
			className="analytics-view__panel analytics-view__section"
		>
			<h2 className="analytics-view__label analytics-view__heading" id={headingId}>
				{title}
			</h2>
			<QueryError query={query} />
			{body()}
		</Card>
	)
}
