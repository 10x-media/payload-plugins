'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { revenueCurrencyOf } from '../goals/currency'
import { refreshCache } from '../query/fetchQuery'
import type { ItemLabels } from '../query/response'
import { keys } from '../translations/keys'
import { isolate } from '../translations/parts'
import { useTranslation } from '../translations/useTranslation'
import { SourcesNoticeBanner } from '../ui/components/SourcesNoticeBanner'
import { mergeNotices, readMeta } from '../widgets/readMeta'
import { canToggleAggregate, scopeLabel } from './scopeLabel'
import { NoSources } from './sections/EmptyStates'
import { ExcludeBrowser } from './sections/ExcludeBrowser'
import { rangeFor, type ViewState } from './state'
import { useViewQueries, type ViewQueries } from './useViewQueries'
import { useViewState } from './useViewState'
import { type ViewAnswers, ViewProvider, type ViewRefresh } from './viewContext'
import type { AnalyticsViewClientProps } from './viewProps'
import '../ui/analytics.css'

/** @beta */
export interface ViewRootProps extends AnalyticsViewClientProps {
	/** The sections, in the order they read; each finds the view through `useView`. */
	children?: ReactNode
}

/**
 * Clears the server's cache, then reissues every section read. The realtime strip is left out: it
 * polls its own window, never the cache the epoch keys.
 */
const useRefresh = (endpoint: string, queries: ViewQueries, tick: () => void): ViewRefresh => {
	const inFlight = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [failed, setFailed] = useState(false)
	const [done, setDone] = useState(false)

	// The refresh answers after the clock moved, which may be a new day with new reads: it reissues
	// the sections as they are then, not as they were when it started.
	const latestQueries = useRef(queries)
	useEffect(() => {
		latestQueries.current = queries
	})

	const run = useCallback((): void => {
		if (pending) {
			return
		}
		const controller = new AbortController()
		inFlight.current = controller
		setPending(true)
		setFailed(false)
		setDone(false)
		tick()
		refreshCache(endpoint, { signal: controller.signal }).then(
			() => {
				if (controller.signal.aborted) return
				setPending(false)
				setDone(true)
				const sections = latestQueries.current
				sections.cards.refetch()
				sections.trend.refetch()
				sections.breakdown.refetch()
				sections.goals?.refetch()
			},
			() => {
				if (controller.signal.aborted) return
				setPending(false)
				setFailed(true)
			}
		)
	}, [endpoint, pending, tick])

	useEffect(
		() => () => {
			inFlight.current?.abort()
		},
		[]
	)

	return { run, pending, failed, done }
}

/** {@link ViewAnswers} from whichever reads have answered so far. */
const answersOf = (
	queries: ViewQueries,
	state: ViewState,
	installCurrency: string | undefined
): ViewAnswers => {
	const sections = [
		queries.cards,
		queries.trend,
		queries.breakdown,
		...(queries.goals ? [queries.goals] : []),
	]
	// Every section carries the filters, so any answer holds the titles an item chip needs.
	let itemLabels: ItemLabels | undefined
	for (const section of sections) {
		const labels = section.data?.itemLabels
		if (labels) {
			itemLabels = Object.assign(itemLabels ?? {}, labels)
		}
	}
	// The rate columns divide by the range's own visitor total, which is a count and never null.
	const visitorTotal = queries.cards.data?.result.totals?.visitors
	// What the answering source says its revenue is in; before an answer, the install's own, or
	// the one currency the view is filtered to, whose amounts count as they were sent.
	const currency =
		sections.find((section) => section.data?.result.meta.currency)?.data?.result.meta.currency ??
		revenueCurrencyOf(state.filters, installCurrency)
	return {
		// Whichever section has answered names the source that answered it; every section
		// reads through the same one.
		provider: sections.find((section) => section.data)?.data?.result.meta.provider ?? '',
		...(currency ? { currency } : {}),
		...(itemLabels ? { itemLabels } : {}),
		notices: mergeNotices(
			...sections.map((section) => (section.data ? readMeta(section.data.result) : undefined))
		),
		...(typeof visitorTotal === 'number' ? { siteVisitors: visitorTotal } : {}),
	}
}

/**
 * View frame without its sections: heading, state, the four reads, refresh, no-source state and
 * exclusion panel. Children read it through `useView`; the reads run whichever are rendered.
 *
 * @beta
 */
export function ViewRoot({ children, ...props }: ViewRootProps) {
	const { t } = useTranslation()
	const view = useViewState(props)
	const { state, stateKey, source, now, tick } = view
	const served = view.gate
	const queries = useViewQueries(props, state, now)
	const refresh = useRefresh(props.endpoints.refresh, queries, tick)

	// Names the scope the render resolved, never what the address asked for. Where the toolbar
	// draws the Site select, that already says it.
	const scopes = props.scopes
	// The site's name isolated, so a Latin name keeps its place in a right-to-left caption.
	const scopeCaption = scopes
		? t(keys.viewScopeShowing, { site: isolate(scopeLabel(scopes, t(keys.viewScopeAll))) })
		: null
	const heading = (withCaption: boolean) => (
		<>
			<h1 className="analytics-view__title">{t(keys.viewTitle)}</h1>
			{scopeCaption === null || !withCaption ? null : (
				<span className="analytics-view__caption">{scopeCaption}</span>
			)}
		</>
	)

	// Staff leave their own browsers out before the first visit counts, so it is offered even
	// while the scope has nothing to read yet.
	const exclusion = props.exclusion ? <ExcludeBrowser endpoint={props.exclusion.endpoint} /> : null

	if (!source || !served) {
		return (
			<div className="analytics-view">
				{heading(true)}
				<NoSources needsScope={props.needsScope === true} />
				{exclusion}
			</div>
		)
	}

	return (
		<ViewProvider
			value={{
				props,
				state,
				stateKey,
				source,
				gate: served,
				range: rangeFor(state, props.timezone, now),
				now,
				queries,
				answers: answersOf(queries, state, props.currency),
				write: view.write,
				refresh,
			}}
		>
			<div className="analytics-view">
				{heading(scopes === undefined || !canToggleAggregate(scopes))}
				<SourcesNoticeBanner notice={props.sources.notice} />
				{children}
				{exclusion}
			</div>
		</ViewProvider>
	)
}
