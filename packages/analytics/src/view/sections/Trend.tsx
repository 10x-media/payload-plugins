'use client'

import { TrendChart, type TrendPoint } from '../../charts/TrendChart'
import type { AnalyticsResult, Granularity, MetricKey } from '../../core/contract'
import { formatMetricValue } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { GRANULARITY_LABELS } from '../labels'
import type { QueryState } from '../useViewQueries'
import { SectionEmpty, SectionError, Skeleton } from './EmptyStates'

export interface TrendProps {
	query: QueryState<QueryResponse>
	metric: MetricKey
	/** The bucket the read was requested at; the rows arrive already aggregated to it. */
	granularity: Granularity
	compare: boolean
	locale: string
	timezone: string
	rangeCaption: string
}

interface BucketArgs {
	granularity: Granularity
	locale: string
	timezone: string
}

/**
 * Bucket labels come from the row timestamps at the granularity the read asked for, rather
 * than from `charts/bucket.ts`: those helpers re-aggregate a daily series and cannot label
 * an hourly one, while the endpoint already returns exactly the buckets that were asked for.
 */
const labelFor = (
	timestamp: string | undefined,
	{ granularity, locale, timezone: timeZone }: BucketArgs
): string => {
	if (timestamp === undefined) {
		return ''
	}
	const at = new Date(timestamp)
	if (Number.isNaN(at.getTime())) {
		return timestamp
	}
	if (granularity === 'minute' || granularity === 'hour') {
		return new Intl.DateTimeFormat(locale, {
			hour: '2-digit',
			minute: '2-digit',
			timeZone,
		}).format(at)
	}
	if (granularity === 'month') {
		return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone }).format(at)
	}
	return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(at)
}

const pointsOf = (
	result: AnalyticsResult | undefined,
	metric: MetricKey,
	bucket: BucketArgs
): TrendPoint[] =>
	(result?.rows ?? []).map((row) => {
		const value = row.metrics[metric] ?? 0
		return {
			label: labelFor(row.timestamp, bucket),
			value,
			display: formatMetricValue(metric, value, bucket.locale),
		}
	})

/**
 * The charted metric over the window, with the comparison period overlaid on the same
 * axes when the view asked for one. Both series are bucketed identically, so the overlay
 * aligns to the primary axis by index.
 */
export function Trend({
	query,
	metric,
	granularity,
	compare,
	locale,
	timezone,
	rangeCaption,
}: TrendProps) {
	const { t } = useTranslation()
	const title = t(METRIC_KEYS[metric])
	const caption = `${rangeCaption} · ${t(GRANULARITY_LABELS[granularity])}`
	const bucket = { granularity, locale, timezone }
	const points = pointsOf(query.data?.result, metric, bucket)
	const previous = compare ? pointsOf(query.data?.comparison, metric, bucket) : []

	return (
		<section
			aria-busy={query.isRefetching}
			className="analytics-view__panel analytics-view__section"
		>
			<span className="analytics-view__label">{title}</span>
			{query.status === 'error' ? (
				<SectionError error={query.error ?? new Error('')} onRetry={query.refetch} />
			) : null}
			{query.data === undefined ? (
				query.status === 'error' ? null : (
					<Skeleton rows={1} variant="chart" />
				)
			) : points.length === 0 ? (
				<SectionEmpty />
			) : (
				<>
					<TrendChart
						ariaLabel={`${title} ${caption}`}
						buckets={points}
						{...(previous.length > 0
							? {
									comparison: previous,
									comparisonLabel: t(keys.viewTrendPrevious),
									label: title,
								}
							: {})}
						minHeight={200}
					/>
					<span className="analytics-view__caption">{caption}</span>
				</>
			)}
		</section>
	)
}
