'use client'

import { type ReactNode, useId } from 'react'
import { formatMetricValue, formatRate } from '../../fields/format'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { Card } from '../../ui/components/Card'
import { DataTable } from '../../ui/components/DataTable'
import { sourceRowsOf, toDisplayRows } from '../../ui/rows/toDisplayRows'
import type { QueryState } from '../useViewQueries'
import type { ViewGoal } from '../viewProps'
import { goalsEmptyLabel, QueryError, SectionEmpty, Skeleton } from './EmptyStates'

export interface GoalsPanelProps {
	query: QueryState<QueryResponse>
	/** Configured goals, for the display name behind a slug. */
	goals: ViewGoal[]
	/** Range total the rate divides by; undefined when the source does not serve visitors. */
	siteVisitors?: number
	locale: string
	/** ISO 4217 code revenue renders in; absent leaves it a plain number. */
	currency?: string
}

/**
 * Conversions per goal. Revenue stays a bare number without an install currency, since a goal's
 * currency is then per goal; the rate is left out when either visitor side is missing.
 */
export function GoalsPanel({ query, goals, siteVisitors, locale, currency }: GoalsPanelProps) {
	const { t } = useTranslation()
	const headingId = useId()
	const builtinGoalSlugs = query.data?.builtinGoalSlugs
	const rows = toDisplayRows(sourceRowsOf(query.data?.result.rows ?? [], 'goal'), {
		dimension: 'goal',
		provider: query.data?.result.meta.provider ?? '',
		t,
		locale,
		goals,
		...(builtinGoalSlugs ? { builtinGoalSlugs } : {}),
		countryFlags: false,
		...(siteVisitors === undefined ? {} : { siteVisitors }),
	})
	const servesRevenue = rows.some((row) => row.metrics.revenue !== undefined)
	const servesRate = rows.some((row) => typeof row.rate === 'number')

	const body = (): ReactNode => {
		if (query.data === undefined) {
			return query.status === 'error' ? null : (
				<Skeleton rows={Math.max(goals.length, 1)} variant="table" />
			)
		}
		if (query.data.result.meta.goalsUnresolved === true || rows.length === 0) {
			return <SectionEmpty label={goalsEmptyLabel(query.data)} />
		}
		return (
			<DataTable
				columns={[
					{ key: 'conversions', header: t(METRIC_KEYS.conversions) },
					...(servesRevenue ? [{ key: 'revenue', header: t(METRIC_KEYS.revenue) }] : []),
					...(servesRate ? [{ key: 'rate', header: t(keys.viewConversionRate) }] : []),
				]}
				label={t(keys.goalsCollectionPlural)}
				labelHeader={t(keys.fieldGoalLabel)}
				noValueLabel={t(keys.stateNoValue)}
				rows={rows.map((row) => ({
					key: row.key,
					label: row.label,
					cells: [
						formatMetricValue('conversions', row.metrics.conversions ?? 0, locale),
						...(servesRevenue
							? [formatMetricValue('revenue', row.metrics.revenue ?? 0, { locale, currency })]
							: []),
						...(servesRate ? [formatRate(row.rate, locale)] : []),
					],
				}))}
			/>
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
				{t(keys.goalsCollectionPlural)}
			</h2>
			<QueryError query={query} />
			{body()}
		</Card>
	)
}
