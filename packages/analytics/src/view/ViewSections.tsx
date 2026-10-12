'use client'

import type { ReactNode } from 'react'
import { PLATFORM_SCOPE } from '../core/contract'
import { MAX_QUERY_FILTERS } from '../query/limits'
import type { QueryResponse } from '../query/response'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { dayRangeCaption } from './dayRange'
import { autoGranularity } from './gating'
import { Breakdowns } from './sections/Breakdowns'
import { isSourceFailure } from './sections/EmptyStates'
import { GoalsPanel } from './sections/GoalsPanel'
import { OverviewCards } from './sections/OverviewCards'
import { RealtimeStrip } from './sections/RealtimeStrip'
import { SectionBoundary } from './sections/SectionBoundary'
import { Trend } from './sections/Trend'
import { withoutFilter } from './state'
import type { QueryState } from './useViewQueries'
import { useViewFrame } from './viewContext'

/**
 * Keeps one throwing section from blanking the view. Everything a section reads is in the key, so
 * moving away from whatever broke it brings it back.
 */
function ViewSection({ children }: { children: ReactNode }) {
	const { stateKey, props } = useViewFrame()
	const { t } = useTranslation()
	return (
		<SectionBoundary label={t(keys.viewErrorGeneric)} resetKey={`${stateKey}|${props.scopeKey}`}>
			{children}
		</SectionBoundary>
	)
}

/**
 * True when the source itself failed this section's read and the overview's alike: the overview
 * says so once for the whole view, so the section draws nothing rather than say it again.
 */
const toldByOverview = (
	section: QueryState<QueryResponse>,
	cards: QueryState<QueryResponse>
): boolean =>
	section.status === 'error' &&
	isSourceFailure(section.error) &&
	cards.status === 'error' &&
	isSourceFailure(cards.error)

/**
 * The range totals, wired to the view: a card click charts its metric. A failure of the source
 * itself is said here, once, for every section.
 *
 * @beta
 */
export function ViewOverview() {
	return (
		<ViewSection>
			<Overview />
		</ViewSection>
	)
}

function Overview() {
	const { gate, state, queries, answers, props, write } = useViewFrame()
	return (
		<OverviewCards
			compare={state.compare}
			currency={answers.currency}
			locale={props.locale}
			metrics={gate.metrics}
			onSelect={(metric) => write({ ...state, metric })}
			query={queries.cards}
			selected={state.metric}
		/>
	)
}

/**
 * The charted metric over the view's window, bucketed as the read asked; nothing while the
 * overview reports the source itself failing.
 *
 * @beta
 */
export function ViewTrend() {
	return (
		<ViewSection>
			<TrendSection />
		</ViewSection>
	)
}

function TrendSection() {
	const { source, state, range, queries, answers, props, now } = useViewFrame()
	if (toldByOverview(queries.trend, queries.cards)) {
		return null
	}
	return (
		<Trend
			compare={state.compare}
			currency={answers.currency}
			granularity={state.granularity ?? autoGranularity(range, source.capabilities)}
			locale={props.locale}
			metric={state.metric}
			now={now}
			query={queries.trend}
			rangeCaption={dayRangeCaption(range, props.locale, props.timezone)}
			timezone={props.timezone}
		/>
	)
}

/**
 * Dimension tables wired to the view: a row click adds a filter, every control is a step. Nothing
 * while the overview reports the source itself failing.
 *
 * @beta
 */
export function ViewBreakdowns() {
	return (
		<ViewSection>
			<BreakdownsSection />
		</ViewSection>
	)
}

function BreakdownsSection() {
	const { gate, state, queries, answers, props, write } = useViewFrame()
	const dimensions = gate.dimensionsFor(state.tab)
	const dimension = state.dim ?? dimensions[0] ?? null
	// A row click adds an `eq` filter, so the dimension has to take that operator in particular.
	const canFilter = dimension !== null && gate.operatorsFor(dimension).includes('eq')

	if (toldByOverview(queries.breakdown, queries.cards)) {
		return null
	}

	const addFilter = (value: string): void => {
		if (dimension === null || state.filters.length >= MAX_QUERY_FILTERS) {
			return
		}
		const already = state.filters.some(
			(filter) =>
				filter.dimension === dimension && filter.operator === 'eq' && filter.value === value
		)
		if (already) {
			return
		}
		write({ ...state, filters: [...state.filters, { dimension, operator: 'eq', value }] })
	}

	return (
		<Breakdowns
			canFilter={canFilter}
			columns={dimension === null ? [] : gate.metricsFor(dimension, state.metric)}
			countryFlags={props.countryFlags}
			currency={answers.currency}
			dimension={dimension}
			dimensions={dimensions}
			filters={state.filters}
			goals={props.goals}
			limit={state.limit}
			locale={props.locale}
			onFilterRemove={(index) => write(withoutFilter(state, index))}
			// The tab's default is its absence, so picking it back writes a link without `dim`.
			onDimensionChange={(dim) => write({ ...state, dim: dim === dimensions[0] ? undefined : dim })}
			onLimitChange={(limit) => write({ ...state, limit })}
			onRowSelect={addFilter}
			onSortChange={(order) => write({ ...state, order })}
			// A grouping belongs to the tab that offered it, so a new tab starts on its own default.
			onTabChange={(tab) => write({ ...state, tab, dim: undefined })}
			order={state.order}
			query={queries.breakdown}
			siteVisitors={answers.siteVisitors}
			tab={state.tab}
			tabs={gate.tabs}
		/>
	)
}

/**
 * Conversions per goal, while the source serves a goal breakdown and the overview reports no
 * failure of the source itself.
 *
 * @beta
 */
export function ViewGoals() {
	return (
		<ViewSection>
			<GoalsSection />
		</ViewSection>
	)
}

function GoalsSection() {
	const { gate, queries, answers, props } = useViewFrame()
	if (!gate.goals || queries.goals === null || toldByOverview(queries.goals, queries.cards)) {
		return null
	}
	return (
		<GoalsPanel
			currency={answers.currency}
			goals={props.goals}
			locale={props.locale}
			query={queries.goals}
			siteVisitors={answers.siteVisitors}
		/>
	)
}

/**
 * The live strip, while the source counts live visitors.
 *
 * @beta
 */
export function ViewRealtime() {
	return (
		<ViewSection>
			<RealtimeSection />
		</ViewSection>
	)
}

function RealtimeSection() {
	const { gate, state, source, props } = useViewFrame()
	if (!gate.realtime) {
		return null
	}
	return (
		<RealtimeStrip
			endpoint={props.endpoints.live}
			locale={props.locale}
			{...(state.scope === undefined ? {} : { scope: PLATFORM_SCOPE })}
			sourceId={source.id}
			timezone={props.timezone}
		/>
	)
}
