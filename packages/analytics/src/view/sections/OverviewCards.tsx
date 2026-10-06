'use client'

import type { MetricKey } from '../../core/contract'
import { formatMetricValue } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { ComparisonDelta } from '../../widgets/ComparisonDelta'
import type { QueryState } from '../useViewQueries'
import { SectionError, Skeleton } from './EmptyStates'

export interface OverviewCardsProps {
	metrics: MetricKey[]
	selected: MetricKey
	query: QueryState<QueryResponse>
	compare: boolean
	locale: string
	onSelect: (metric: MetricKey) => void
}

/**
 * The range totals, one card per metric the source serves. The card for the charted metric
 * is pressed, and clicking another charts it. Totals stay on screen while the next read is
 * in flight, so changing the range dims the numbers rather than blanking them.
 */
export function OverviewCards({
	metrics,
	selected,
	query,
	compare,
	locale,
	onSelect,
}: OverviewCardsProps) {
	const { t } = useTranslation()
	const totals = query.data?.result.totals
	const previous = query.data?.comparison?.totals

	if (query.data === undefined) {
		return query.status === 'error' ? (
			<SectionError error={query.error ?? new Error('')} onRetry={query.refetch} />
		) : (
			<div className="analytics-view__cards">
				<Skeleton rows={Math.max(metrics.length, 1)} />
			</div>
		)
	}

	return (
		<>
			{query.status === 'error' ? (
				<SectionError error={query.error ?? new Error('')} onRetry={query.refetch} />
			) : null}
			{/** biome-ignore lint/a11y/useSemanticElements: a named group of toggle buttons, not a form fieldset */}
			<div
				aria-busy={query.isRefetching}
				aria-label={t(keys.viewOverview)}
				className="analytics-view__cards"
				role="group"
			>
				{metrics.map((metric) => {
					const value = totals?.[metric]
					return (
						<button
							aria-pressed={metric === selected}
							className="analytics-view__card"
							key={metric}
							onClick={() => onSelect(metric)}
							type="button"
						>
							<span className="analytics-view__label">{t(METRIC_KEYS[metric])}</span>
							<span className="analytics-view__value">
								{value === undefined ? '-' : formatMetricValue(metric, value, locale)}
							</span>
							{compare ? (
								<ComparisonDelta
									current={value}
									locale={locale}
									metric={metric}
									previous={previous?.[metric]}
									t={t}
								/>
							) : null}
						</button>
					)
				})}
			</div>
		</>
	)
}
