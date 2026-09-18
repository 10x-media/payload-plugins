'use client'

import { SelectInput } from '@payloadcms/ui'
import { type KeyboardEvent, useRef } from 'react'
import { BarList } from '../../charts/BarList'
import type { DimensionKey, MetricKey } from '../../core/contract'
import { formatMetricValue } from '../../fields/format'
import { askedAboutNoGoals, type QueryResponse } from '../../query/response'
import { keys, type TranslationKey } from '../../translations/keys'
import { METRIC_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import type { BreakdownTab } from '../gating'
import { DIMENSION_LABELS, isUnsetValue, TAB_LABELS, valueLabel } from '../labels'
import { VIEW_LIMITS, type ViewLimit, type ViewState } from '../state'
import type { QueryState } from '../useViewQueries'
import { SectionError, Skeleton } from './EmptyStates'

export interface BreakdownsProps {
	tabs: BreakdownTab[]
	tab: BreakdownTab
	/** The dimension the active tab reads; null when the source serves none. */
	dimension: DimensionKey | null
	/** Everything the active tab can group by. More than one earns the group-by picker. */
	dimensions: DimensionKey[]
	metric: MetricKey
	query: QueryState<QueryResponse>
	limit: ViewLimit
	order?: ViewState['order']
	/** The source can filter by this tab's dimension, so a row click is meaningful. */
	canFilter: boolean
	locale: string
	onTabChange: (tab: BreakdownTab) => void
	onDimensionChange: (dimension: DimensionKey) => void
	onLimitChange: (limit: ViewLimit) => void
	onSortChange: (order: NonNullable<ViewState['order']>) => void
	onRowSelect: (value: string) => void
}

const SECONDARY: MetricKey = 'visitors'

const nextIndex = (key: string, at: number, length: number): number | null => {
	if (key === 'ArrowRight') return (at + 1) % length
	if (key === 'ArrowLeft') return (at - 1 + length) % length
	if (key === 'Home') return 0
	if (key === 'End') return length - 1
	return null
}

/**
 * The dimension tables, one tab per group the source serves, with a group-by picker on any
 * tab that groups by more than one. A row is a button only when the source can filter by
 * the dimension on screen and the row carries a value; otherwise the rows are inert and the
 * caption says so, rather than offering a click the endpoint would reject.
 */
export function Breakdowns({
	tabs,
	tab,
	dimension,
	dimensions,
	metric,
	query,
	limit,
	order,
	canFilter,
	locale,
	onTabChange,
	onDimensionChange,
	onLimitChange,
	onSortChange,
	onRowSelect,
}: BreakdownsProps) {
	const { t } = useTranslation()
	const strip = useRef<HTMLDivElement>(null)

	const served = query.data?.result.rows ?? []
	// Only the native source buckets `source` into channels; a provider serves a raw utm_source
	// under the same name, so the label formatter needs to know which answered.
	const provider = query.data?.result.meta.provider ?? ''
	// A goal breakdown has two empty states of its own the plain one would read as "nobody
	// converted": the source could not answer about the goals, and the scope configures none.
	const goalEmptyLabel = (): TranslationKey => {
		if (query.data?.result.meta.goalsUnresolved === true) {
			return keys.stateGoalsUnresolved
		}
		return askedAboutNoGoals(query.data?.query) ? keys.stateNoGoals : keys.stateNoBreakdown
	}
	const emptyLabel = dimension === 'goal' ? goalEmptyLabel() : keys.stateNoBreakdown
	// The read kept on screen through a refetch answers the grouping that was asked for when
	// it was issued, so switching tab or dimension leaves rows that carry no value for the one
	// now selected. They are not this breakdown's rows: showing them would be a run of
	// unlabeled bars ranked by somebody else's numbers, so the panel waits for the answer.
	const rows =
		dimension === null ? [] : served.filter((row) => row.dimensions?.[dimension] !== undefined)
	const answered = dimension === null || served.length === 0 || rows.length > 0
	const carried = (candidate: MetricKey): boolean =>
		rows.some((row) => row.metrics[candidate] !== undefined)
	// A source can group by a dimension without serving the selected metric per row (Umami's
	// /metrics reports visitors and nothing else), so the list charts the first metric of the
	// read that some row carries rather than a run of zeros under the wrong name.
	const charted = carried(metric)
		? metric
		: ((query.data?.query.metrics ?? []).find(carried) ?? metric)
	const servesSecondary = carried(SECONDARY)
	const dimensionLabel = dimension === null ? t(TAB_LABELS[tab]) : t(DIMENSION_LABELS[dimension])

	const onStripKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const at = tabs.indexOf(tab)
		const to = nextIndex(event.key, at, tabs.length)
		const next = to === null ? undefined : tabs[to]
		if (next === undefined) {
			return
		}
		event.preventDefault()
		onTabChange(next)
		strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to ?? 0]?.focus()
	}

	const sortBy = (column: MetricKey): void => {
		const active = order?.metric === column
		onSortChange({
			metric: column,
			direction: active && order?.direction === 'desc' ? 'asc' : 'desc',
		})
	}

	const sortLabel = (column: MetricKey): string => {
		if (order?.metric !== column) {
			return t(METRIC_KEYS[column])
		}
		const direction = order.direction === 'asc' ? keys.viewSortAscending : keys.viewSortDescending
		return `${t(METRIC_KEYS[column])}, ${t(direction)}`
	}

	return (
		<section
			aria-busy={query.isRefetching}
			className="analytics-view__panel analytics-view__section analytics-view__breakdown"
		>
			<div
				aria-label={t(keys.viewBreakdowns)}
				className="analytics-view__tabs"
				onKeyDown={onStripKeyDown}
				ref={strip}
				role="tablist"
			>
				{tabs.map((candidate) => (
					<button
						aria-controls="analytics-view-breakdown-panel"
						aria-selected={candidate === tab}
						className="analytics-view__tab"
						id={`analytics-view-tab-${candidate}`}
						key={candidate}
						onClick={() => onTabChange(candidate)}
						role="tab"
						tabIndex={candidate === tab ? 0 : -1}
						type="button"
					>
						{t(TAB_LABELS[candidate])}
					</button>
				))}
			</div>
			<div
				aria-labelledby={`analytics-view-tab-${tab}`}
				id="analytics-view-breakdown-panel"
				role="tabpanel"
			>
				{query.status === 'error' ? (
					<SectionError error={query.error ?? new Error('')} onRetry={query.refetch} />
				) : null}
				{query.data === undefined || !answered ? (
					query.status === 'error' ? null : (
						<Skeleton rows={Math.min(limit, 5)} variant="row" />
					)
				) : (
					<>
						<div className="analytics-view__bars-head">
							<span className="analytics-view__bars-head-dimension">{dimensionLabel}</span>
							<button
								aria-pressed={order?.metric === charted}
								className="analytics-view__sort analytics-view__sort--metric"
								onClick={() => sortBy(charted)}
								type="button"
							>
								{sortLabel(charted)}
							</button>
							{servesSecondary && charted !== SECONDARY ? (
								<button
									aria-pressed={order?.metric === SECONDARY}
									className="analytics-view__sort analytics-view__sort--secondary"
									onClick={() => sortBy(SECONDARY)}
									type="button"
								>
									{sortLabel(SECONDARY)}
								</button>
							) : null}
						</div>
						<BarList
							data={rows.map((row) => {
								const value = row.metrics[charted] ?? 0
								const secondary =
									servesSecondary && charted !== SECONDARY ? row.metrics[SECONDARY] : undefined
								const stored = (dimension === null ? undefined : row.dimensions?.[dimension]) ?? ''
								return {
									label:
										dimension === null
											? stored
											: valueLabel({ dimension, value: stored, provider, t }),
									value,
									display: formatMetricValue(charted, value, locale),
									// A filter value is one character at minimum, so the row a source
									// answered with no value has nothing to filter on.
									selectable: !isUnsetValue(stored),
									...(secondary === undefined
										? {}
										: { secondary: formatMetricValue(SECONDARY, secondary, locale) }),
								}
							})}
							emptyLabel={t(emptyLabel)}
							fill="soft"
							{...(canFilter
								? {
										onSelect: (index: number) => {
											const value =
												dimension === null ? undefined : rows[index]?.dimensions?.[dimension]
											if (value !== undefined && !isUnsetValue(value)) {
												onRowSelect(value)
											}
										},
									}
								: {})}
						/>
					</>
				)}
			</div>
			<div className="analytics-view__controls">
				{dimensions.length > 1 ? (
					<div className="analytics-view__control">
						<SelectInput
							isClearable={false}
							label={t(keys.viewGroupBy)}
							name="analytics-dimension"
							onChange={(selected) => {
								const option = Array.isArray(selected) ? selected[0] : selected
								const value = (option as { value?: unknown } | null)?.value
								const picked = dimensions.find((candidate) => candidate === value)
								if (picked !== undefined) {
									onDimensionChange(picked)
								}
							}}
							options={dimensions.map((option) => ({
								value: option,
								label: t(DIMENSION_LABELS[option]),
							}))}
							path="analytics-dimension"
							value={dimension ?? undefined}
						/>
					</div>
				) : null}
				<div className="analytics-view__control">
					<SelectInput
						isClearable={false}
						label={t(keys.widgetFieldLimit)}
						name="analytics-limit"
						onChange={(selected) => {
							const option = Array.isArray(selected) ? selected[0] : selected
							const value = Number((option as { value?: unknown } | null)?.value)
							if (VIEW_LIMITS.includes(value as ViewLimit)) {
								onLimitChange(value as ViewLimit)
							}
						}}
						options={VIEW_LIMITS.map((option) => ({
							value: String(option),
							label: String(option),
						}))}
						path="analytics-limit"
						value={String(limit)}
					/>
				</div>
				{canFilter ? null : (
					<span className="analytics-view__caption">{t(keys.viewFiltersUnsupported)}</span>
				)}
			</div>
		</section>
	)
}
