'use client'

import { type KeyboardEvent, useId, useRef } from 'react'
import { barShares } from '../../charts/bars'
import type { AnalyticsFilter, DimensionKey, MetricKey } from '../../core/contract'
import { readingOf } from '../../core/metricValues'
import { formatMetricValue, formatRate } from '../../fields/format'
import { rowCurrencyOf } from '../../goals/currency'
import type { QueryResponse } from '../../query/response'
import { keys } from '../../translations/keys'
import { metricLabelKey } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { Card } from '../../ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableRow } from '../../ui/components/DataTable'
import { LabeledSelect } from '../../ui/components/LabeledSelect'
import { arrowStep, type Direction, useDirection } from '../../ui/hooks/useDirection'
import { sourceRowsOf, toDisplayRows } from '../../ui/rows/toDisplayRows'
import { type CountryFlags, RowFlag } from '../CountryFlag'
import { type BreakdownTab, CLICK_RATE_DIMENSIONS } from '../gating'
import { DIMENSION_LABELS, TAB_LABELS, valueLabel } from '../labels'
import { filterKey, VIEW_LIMITS, type ViewLimit, type ViewState } from '../state'
import type { QueryState } from '../useViewQueries'
import type { ViewGoal } from '../viewProps'
import { goalsEmptyLabel, QueryError, Skeleton } from './EmptyStates'
import { FilterChip } from './FilterChips'

export interface BreakdownsProps {
	tabs: BreakdownTab[]
	tab: BreakdownTab
	/** The dimension the active tab reads; null when the source serves none. */
	dimension: DimensionKey | null
	/** Everything the active tab can group by. More than one earns the group-by picker. */
	dimensions: DimensionKey[]
	/** The metric columns this dimension reads, in display order; the first one is charted. */
	columns: MetricKey[]
	/** Range total the conversion-rate column divides by, where the dimension has one. */
	siteVisitors?: number
	/** Configured goals, for the name behind a goal slug. */
	goals: ViewGoal[]
	/** The flag beside a country name: none, the plugin's own, or the host's component. */
	countryFlags: CountryFlags
	query: QueryState<QueryResponse>
	limit: ViewLimit
	order?: ViewState['order']
	/** The source can filter by this tab's dimension, so a row click is meaningful. */
	canFilter: boolean
	locale: string
	/**
	 * ISO 4217 code revenue renders in; absent leaves it a plain number. A currency row renders in
	 * its own code, since its amounts are counted as they were sent.
	 */
	currency?: string
	/**
	 * The view's filters. Those on the dimension on screen show in the header, where the row
	 * that set one was clicked, each with its own remove button.
	 */
	filters?: AnalyticsFilter[]
	/** Removes `filters[index]`. */
	onFilterRemove?: (index: number) => void
	onTabChange: (tab: BreakdownTab) => void
	onDimensionChange: (dimension: DimensionKey) => void
	onLimitChange: (limit: ViewLimit) => void
	onSortChange: (order: NonNullable<ViewState['order']>) => void
	onRowSelect: (value: string) => void
}

/** The tab a key moves to: the arrows step in reading order and wrap, Home and End jump. */
const nextIndex = (
	key: string,
	{ at, length, direction }: { at: number; length: number; direction: Direction }
): number | null => {
	const step = arrowStep(key, direction)
	if (step !== null) return (at + step + length) % length
	if (key === 'Home') return 0
	if (key === 'End') return length - 1
	return null
}

const LIMIT_OPTIONS = VIEW_LIMITS.map((option) => ({
	value: String(option),
	label: String(option),
}))

/** Where a column sits, which sets its header's width whatever it holds. */
type Position = 'value' | 'secondary' | 'tertiary' | 'quaternary'

/**
 * Dimension tables, one tab per served group. A row is a button only when the source can filter
 * the dimension and the row has a value; otherwise rows are inert and the caption says so.
 */
export function Breakdowns({
	tabs,
	tab,
	dimension,
	dimensions,
	columns,
	siteVisitors,
	goals,
	countryFlags,
	query,
	limit,
	order,
	canFilter,
	locale,
	currency,
	filters = [],
	onFilterRemove,
	onTabChange,
	onDimensionChange,
	onLimitChange,
	onSortChange,
	onRowSelect,
}: BreakdownsProps) {
	const { t } = useTranslation()
	const strip = useRef<HTMLDivElement>(null)
	const direction = useDirection(strip)
	const id = useId()
	const headingId = `${id}-heading`
	const panelId = `${id}-panel`
	const tabId = (candidate: BreakdownTab): string => `${id}-tab-${candidate}`

	const served = query.data?.result.rows ?? []
	// Only the native source buckets `source` into channels; a provider serves a raw utm_source
	// under the same name, so the label formatter needs to know which answered.
	const provider = query.data?.result.meta.provider ?? ''
	const emptyLabel = dimension === 'goal' ? goalsEmptyLabel(query.data) : keys.stateNoBreakdown
	// A read kept through a refetch answers the grouping asked when issued; its rows carry no value
	// for a newly picked one and would chart somebody else's numbers, so the panel waits.
	const carrying =
		dimension === null ? [] : served.filter((row) => row.dimensions?.[dimension] !== undefined)
	const itemLabels = query.data?.itemLabels
	const builtinGoalSlugs = query.data?.builtinGoalSlugs
	const rows =
		dimension === null
			? []
			: toDisplayRows(sourceRowsOf(carrying, dimension), {
					dimension,
					provider,
					t,
					locale,
					goals,
					...(builtinGoalSlugs ? { builtinGoalSlugs } : {}),
					...(itemLabels ? { itemLabels } : {}),
					countryFlags: countryFlags !== false,
					...(siteVisitors === undefined ? {} : { siteVisitors }),
				})
	const answered = dimension === null || served.length === 0 || carrying.length > 0
	// A source can group by a dimension without serving a column it declared, so the header
	// names the columns some row carries, falling back to the declared ones when none does.
	const carriedColumns = columns.filter((column) =>
		rows.some((row) => row.metrics[column] !== undefined)
	)
	const present = carriedColumns.length > 0 ? carriedColumns : columns
	const charted = present[0]
	// A bar row carries the charted value, one plain column beside it and the derived rate,
	// so the header lists exactly what the rows can show.
	const rest = present.slice(1, 2)
	const clicks = dimension !== null && CLICK_RATE_DIMENSIONS.includes(dimension)
	// An item row has one more column after its click rate: what the item converted.
	const trailing = clicks ? present.slice(2, 3) : []
	// Rate is row visitors over the site's (an item's clicks over its views), left out when either
	// side is missing rather than shown as a column of dashes.
	const showsRate = rows.some((row) => typeof row.rate === 'number')
	const rateLabel = clicks ? keys.metricClickRate : keys.viewConversionRate
	const dimensionLabel = dimension === null ? t(TAB_LABELS[tab]) : t(DIMENSION_LABELS[dimension])

	const onStripKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const to = nextIndex(event.key, { at: tabs.indexOf(tab), length: tabs.length, direction })
		const next = to === null ? undefined : tabs[to]
		if (to === null || next === undefined) {
			return
		}
		event.preventDefault()
		onTabChange(next)
		strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus()
	}

	// Without an order of its own the read ranks by the dimension's first column, descending.
	const effective: ViewState['order'] =
		order ?? (columns[0] === undefined ? undefined : { metric: columns[0], direction: 'desc' })

	// The bars measure the column the rows are ranked by, so a re-sort moves them with it.
	const shown = [charted, ...rest, ...trailing]
	const barred = shown.find((column) => column === effective?.metric) ?? charted

	const sortBy = (column: MetricKey): void => {
		const active = effective?.metric === column
		onSortChange({
			metric: column,
			direction: active && effective?.direction === 'desc' ? 'asc' : 'desc',
		})
	}

	const sortable = (column: MetricKey, position: Position): DataTableColumn => ({
		key: column,
		header: t(metricLabelKey(column, query.data?.result.meta.visitorsAre === 'sumOfDaily')),
		...(effective?.metric === column
			? { sorted: effective.direction === 'asc' ? 'ascending' : 'descending' }
			: {}),
		onSort: () => sortBy(column),
		className:
			column === barred
				? 'analytics-bars__value'
				: `analytics-bars__${position === 'value' ? 'primary' : position}`,
		headerClassName: `analytics-view__col analytics-view__col--${position}`,
	})

	const tableColumns: DataTableColumn[] = [
		...(charted === undefined ? [] : [sortable(charted, 'value')]),
		...rest.map((column) => sortable(column, 'secondary')),
		// Derived rather than served, so there is nothing to sort by.
		...(showsRate
			? [
					{
						key: 'rate',
						header: t(rateLabel),
						className: 'analytics-bars__tertiary',
						headerClassName: 'analytics-view__col analytics-view__col--tertiary',
					},
				]
			: []),
		...trailing.map((column) => sortable(column, 'quaternary')),
	]

	const shares = barShares(
		rows.map((row) => (barred === undefined ? 0 : readingOf(row.metrics, barred)))
	)

	const tableRows: DataTableRow[] = rows.map((row, i) => {
		const money = rowCurrencyOf(dimension, row.value, currency)
		const cell = (column: MetricKey): string => {
			const value = row.metrics[column]
			return value === undefined
				? ''
				: formatMetricValue(column, value, { locale, currency: money })
		}
		const value = charted === undefined ? 0 : readingOf(row.metrics, charted)
		return {
			key: row.key,
			label: row.label,
			bar: shares[i] ?? 0,
			...(row.flag === null
				? {}
				: { decoration: <RowFlag code={row.flag} flags={countryFlags} /> }),
			// A filter value is one character at minimum, so the row a source answered with no
			// value has nothing to filter on.
			...(canFilter && !row.unset ? { onSelect: () => onRowSelect(row.value) } : {}),
			cells: [
				...(charted === undefined
					? []
					: [formatMetricValue(charted, value, { locale, currency: money })]),
				...rest.map(cell),
				...(showsRate ? [formatRate(row.rate, locale)] : []),
				...trailing.map(cell),
			],
		}
	})

	// The filters a row click on this dimension set, said where the click happened.
	const filtering = filters.flatMap((filter, index) =>
		filter.dimension === dimension ? [{ filter, index }] : []
	)

	return (
		<Card
			aria-busy={query.isRefetching}
			aria-labelledby={headingId}
			as="section"
			className="analytics-view__panel analytics-view__section analytics-view__breakdown"
		>
			<h2 className="analytics-sr-only" id={headingId}>
				{t(keys.viewBreakdowns)}
			</h2>
			<div className="analytics-view__breakdown-head">
				<div
					aria-label={t(keys.viewBreakdowns)}
					className="analytics-view__tabs"
					onKeyDown={onStripKeyDown}
					ref={strip}
					role="tablist"
				>
					{tabs.map((candidate) => (
						<button
							aria-controls={panelId}
							aria-selected={candidate === tab}
							className="analytics-view__tab"
							id={tabId(candidate)}
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
				{filtering.length > 0 && onFilterRemove ? (
					<div className="analytics-view__chips">
						{filtering.map(({ filter, index }) => (
							<FilterChip
								countryFlags={countryFlags}
								filter={filter}
								key={filterKey(filter)}
								onRemove={() => onFilterRemove(index)}
								shown={valueLabel({
									dimension: filter.dimension,
									value: filter.value,
									provider,
									t,
									locale,
									goals,
									...(itemLabels ? { itemLabels } : {}),
								})}
							/>
						))}
					</div>
				) : null}
			</div>
			<div aria-labelledby={tabId(tab)} id={panelId} role="tabpanel">
				<QueryError query={query} />
				{query.data === undefined || !answered ? (
					query.status === 'error' ? null : (
						<Skeleton rows={limit} variant="bars" />
					)
				) : (
					<DataTable
						bars="soft"
						columns={tableColumns}
						emptyLabel={t(emptyLabel)}
						{...(canFilter
							? { filterHint: t(keys.viewFilterBy, { dimension: dimensionLabel }) }
							: {})}
						label={dimensionLabel}
						labelHeader={dimensionLabel}
						noValueLabel={t(keys.stateNoValue)}
						rows={tableRows}
					/>
				)}
			</div>
			<div className="analytics-view__controls">
				{dimensions.length > 1 ? (
					<div className="analytics-view__control">
						<LabeledSelect
							label={t(keys.viewGroupBy)}
							onChange={onDimensionChange}
							options={dimensions.map((option) => ({
								value: option,
								label: t(DIMENSION_LABELS[option]),
							}))}
							value={dimension ?? undefined}
						/>
					</div>
				) : null}
				<div className="analytics-view__control">
					<LabeledSelect
						label={t(keys.widgetFieldLimit)}
						onChange={(value) => {
							const picked = VIEW_LIMITS.find((option) => String(option) === value)
							if (picked !== undefined) {
								onLimitChange(picked)
							}
						}}
						options={LIMIT_OPTIONS}
						value={String(limit)}
					/>
				</div>
				{canFilter ? null : (
					<span className="analytics-view__caption">{t(keys.viewFiltersUnsupported)}</span>
				)}
			</div>
		</Card>
	)
}
