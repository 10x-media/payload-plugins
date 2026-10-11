'use client'

import type { MetricKey } from '../../core/contract'
import { formatMetricValue } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { metricLabelKey } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { MetricCard } from '../../ui/components/MetricCard'
import { ComparisonDelta } from '../../widgets/ComparisonDelta'
import type { QueryState } from '../useViewQueries'
import { QueryError, SectionError, Skeleton } from './EmptyStates'

export interface OverviewCardsProps {
	metrics: MetricKey[]
	selected: MetricKey
	query: QueryState<QueryResponse>
	compare: boolean
	locale: string
	/** ISO 4217 code revenue renders in; absent leaves it a plain number. */
	currency?: string
	onSelect: (metric: MetricKey) => void
}

/**
 * Range totals, one card per served metric; clicking a card charts it. Totals stay through the
 * next read, so a range change dims the numbers rather than blanking them.
 */
export function OverviewCards({
	metrics,
	selected,
	query,
	compare,
	locale,
	currency,
	onSelect,
}: OverviewCardsProps) {
	const { t } = useTranslation()
	const totals = query.data?.result.totals
	const previous = query.data?.comparison?.totals
	const summed = query.data?.result.meta.visitorsAre === 'sumOfDaily'

	if (query.data === undefined) {
		return query.status === 'error' ? (
			<SectionError error={query.error} onRetry={query.refetch} />
		) : (
			<div className="analytics-view__cards">
				<Skeleton delta={compare} rows={Math.max(metrics.length, 1)} />
			</div>
		)
	}

	return (
		<>
			<QueryError query={query} />
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
						<MetricCard
							className="analytics-view__card"
							key={metric}
							label={t(metricLabelKey(metric, summed))}
							noValueLabel={t(keys.stateNoValue)}
							onSelect={() => onSelect(metric)}
							pressed={metric === selected}
							value={formatMetricValue(metric, value, { locale, currency })}
						>
							{compare ? (
								<ComparisonDelta
									current={value}
									locale={locale}
									metric={metric}
									previous={previous?.[metric]}
									t={t}
								/>
							) : null}
						</MetricCard>
					)
				})}
			</div>
		</>
	)
}
