'use client'

import { formatMetricValue } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { conversionRate } from '../conversionRate'
import type { QueryState } from '../useViewQueries'
import type { ViewGoal } from '../viewProps'
import { SectionEmpty, SectionError, Skeleton } from './EmptyStates'

export interface GoalsPanelProps {
	query: QueryState<QueryResponse>
	/** Configured goals, for the display name behind a slug. */
	goals: ViewGoal[]
	/** Range total the rate divides by; undefined when the source does not serve visitors. */
	siteVisitors?: number
	locale: string
}

/**
 * Conversions per goal over the window. Revenue is a bare number: the goal's currency is
 * per goal, not per read, so formatting one column in one currency would be a lie. The
 * rate needs visitors on both sides (the goal's bucket and the site total) and is left out
 * whenever either is missing.
 */
export function GoalsPanel({ query, goals, siteVisitors, locale }: GoalsPanelProps) {
	const { t } = useTranslation()
	const rows = query.data?.result.rows ?? []
	const names = new Map(goals.map((goal) => [goal.slug, goal.name]))
	const servesRevenue = rows.some((row) => row.metrics.revenue !== undefined)
	const rates = rows.map((row) => conversionRate(row.metrics.visitors, siteVisitors))
	const servesRate = rates.some((rate) => rate !== null)
	const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 })

	return (
		<section
			aria-busy={query.isRefetching}
			className="analytics-view__panel analytics-view__section"
		>
			<span className="analytics-view__label">{t(keys.goalsCollectionPlural)}</span>
			{query.status === 'error' ? (
				<SectionError error={query.error ?? new Error('')} onRetry={query.refetch} />
			) : null}
			{query.data === undefined ? (
				query.status === 'error' ? null : (
					<Skeleton rows={3} variant="row" />
				)
			) : query.data.result.meta.goalsUnresolved === true ? (
				// The source never answered about the goals, which the plain empty state would
				// read as "nobody converted".
				<SectionEmpty label={keys.stateGoalsUnresolved} />
			) : rows.length === 0 ? (
				<SectionEmpty label={keys.stateNoBreakdown} />
			) : (
				<div className="analytics-view__scroll">
					<table className="analytics-view__table">
						<thead>
							<tr>
								<th scope="col">{t(keys.fieldGoalLabel)}</th>
								<th scope="col">{t(METRIC_KEYS.conversions)}</th>
								{servesRevenue ? <th scope="col">{t(METRIC_KEYS.revenue)}</th> : null}
								{servesRate ? <th scope="col">{t(keys.viewConversionRate)}</th> : null}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, index) => {
								const slug = row.dimensions?.goal ?? ''
								const rate = rates[index] ?? null
								return (
									<tr key={slug}>
										<td>{names.get(slug) ?? slug}</td>
										<td>
											{formatMetricValue('conversions', row.metrics.conversions ?? 0, locale)}
										</td>
										{servesRevenue ? (
											<td>{formatMetricValue('revenue', row.metrics.revenue ?? 0, locale)}</td>
										) : null}
										{servesRate ? <td>{rate === null ? '-' : percent.format(rate)}</td> : null}
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}
