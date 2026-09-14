'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { MetricKey } from '../core/contract'
import { MAX_QUERY_FILTERS } from '../query/limits'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { dayRangeCaption } from './dayRange'
import { autoGranularity, gate, resolveSource } from './gating'
import { Breakdowns } from './sections/Breakdowns'
import { NoSources } from './sections/EmptyStates'
import { GoalsPanel } from './sections/GoalsPanel'
import { OverviewCards } from './sections/OverviewCards'
import { RealtimeStrip } from './sections/RealtimeStrip'
import { ViewStyles } from './sections/styles'
import { Toolbar } from './sections/Toolbar'
import { Trend } from './sections/Trend'
import { coerceState, parseViewState, rangeFor, serializeViewState, type ViewState } from './state'
import { useViewQueries } from './useViewQueries'
import type { AnalyticsViewClientProps } from './viewProps'

/** A day input fires on every keystroke; only the pause between them is worth a history entry. */
const COMMIT_DELAY_MS = 400

/**
 * The analytics dashboard. Its whole state is the URL, so a link is a view: the query
 * string is parsed on every render, coerced to what the selected source serves, and
 * written back through `router.replace` as the reader works. A coerced value is applied to
 * the reads but deliberately not written back, so a link built for a richer source still
 * opens as intended once that source is selected again.
 */
export function AnalyticsViewClient(props: AnalyticsViewClientProps) {
	const { t } = useTranslation()
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const search = searchParams.toString()

	const parsed = useMemo(
		() => parseViewState(new URLSearchParams(search), props.defaults),
		[search, props.defaults]
	)
	const source = resolveSource(props.sources, parsed.source)
	const served = useMemo(() => (source ? gate(source.capabilities) : null), [source])
	const state = served ? coerceState(parsed, served) : parsed
	const queries = useViewQueries(props, state)

	const href = useCallback(
		(next: ViewState) => {
			const query = serializeViewState(next, props.defaults).toString()
			return query === '' ? pathname : `${pathname}?${query}`
		},
		[pathname, props.defaults]
	)

	/** A click is a step the reader took, so Back undoes it rather than leaving the view. */
	const write = useCallback(
		(next: ViewState) => {
			router.push(href(next), { scroll: false })
		},
		[router, href]
	)

	const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
	/**
	 * Typing in a day input is one edit, not a history of them: the committed value replaces
	 * the entry the picker already wrote rather than stacking one per keystroke pause.
	 */
	const writeLater = useCallback(
		(next: ViewState) => {
			if (pending.current !== null) {
				clearTimeout(pending.current)
			}
			pending.current = setTimeout(() => {
				router.replace(href(next), { scroll: false })
			}, COMMIT_DELAY_MS)
		},
		[router, href]
	)
	useEffect(
		() => () => {
			if (pending.current !== null) {
				clearTimeout(pending.current)
			}
		},
		[]
	)

	if (!source || !served) {
		return (
			<div className="analytics-view">
				<ViewStyles />
				<h1 className="analytics-view__title">{t(keys.viewTitle)}</h1>
				<NoSources />
			</div>
		)
	}

	const now = new Date()
	const range = rangeFor(state, props.timezone, now)
	const sections = [
		queries.cards,
		queries.trend,
		queries.breakdown,
		...(queries.goals ? [queries.goals] : []),
	]
	const dimension = served.dimensionsFor(state.tab)[0] ?? null
	const canFilter = dimension !== null && served.canFilter(dimension)

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
		write({
			...state,
			filters: [...state.filters, { dimension, operator: 'eq', value }],
		})
	}

	return (
		<div className="analytics-view">
			<ViewStyles />
			<h1 className="analytics-view__title">{t(keys.viewTitle)}</h1>
			<Toolbar
				clamped={sections.some((section) => section.data?.result.meta.clamped === true)}
				gate={served}
				locale={props.locale}
				now={now}
				onChange={write}
				onChangeDeferred={writeLater}
				range={range}
				sourceId={source.id}
				sources={props.sources.sources}
				stale={sections.some((section) => section.data?.result.meta.stale === true)}
				state={state}
				timezone={props.timezone}
			/>
			<OverviewCards
				compare={state.compare}
				locale={props.locale}
				metrics={served.metrics}
				onSelect={(metric: MetricKey) => write({ ...state, metric })}
				query={queries.cards}
				selected={state.metric}
			/>
			<Trend
				compare={state.compare}
				granularity={state.granularity ?? autoGranularity(range, source.capabilities)}
				locale={props.locale}
				metric={state.metric}
				query={queries.trend}
				rangeCaption={dayRangeCaption(range, props.locale, props.timezone)}
				timezone={props.timezone}
			/>
			<Breakdowns
				canFilter={canFilter}
				dimension={dimension}
				limit={state.limit}
				locale={props.locale}
				metric={state.metric}
				onLimitChange={(limit) => write({ ...state, limit })}
				onRowSelect={addFilter}
				onSortChange={(order) => write({ ...state, order })}
				onTabChange={(tab) => write({ ...state, tab })}
				{...(state.order === undefined ? {} : { order: state.order })}
				query={queries.breakdown}
				tab={state.tab}
				tabs={served.tabs}
			/>
			{served.goals && queries.goals ? (
				<GoalsPanel
					goals={props.goals}
					locale={props.locale}
					query={queries.goals}
					{...(queries.cards.data?.result.totals?.visitors === undefined
						? {}
						: { siteVisitors: queries.cards.data.result.totals.visitors })}
				/>
			) : null}
			{served.realtime ? (
				<RealtimeStrip apiRoute={props.apiRoute} locale={props.locale} sourceId={source.id} />
			) : null}
		</div>
	)
}
