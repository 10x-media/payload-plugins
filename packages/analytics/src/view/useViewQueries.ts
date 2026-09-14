'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MetricKey } from '../core/contract'
import { fetchQuery, type QueryRequest } from '../query/fetchQuery'
import type { QueryResponse } from '../query/response'
import { autoGranularity, gate, resolveSource } from './gating'
import { coerceState, rangeFor, type ViewState } from './state'
import type { AnalyticsViewClientProps } from './viewProps'

/**
 * One section's read. `error` is a `QueryFetchError` whenever the endpoint answered.
 *
 * `data` survives into the next `loading` and into an `error`, so changing the range or
 * hitting a transient failure dims or annotates the chart it already shows instead of
 * blanking it; `isRefetching` is the loading half of that, and is the flag to render a
 * subtle busy affordance on. `status === 'loading'` with no `data` is the only real empty
 * load, and the only one that earns a skeleton. A section that stops being servable at all
 * drops its data, since it belongs to a source or tab the view is no longer showing.
 */
export interface QueryState<T> {
	status: 'loading' | 'ok' | 'error'
	/** May be the previous read's answer while `status` is `loading` or `error`. */
	data?: T
	error?: Error
	isRefetching: boolean
	refetch: () => void
}

export interface ViewQueries {
	cards: QueryState<QueryResponse>
	trend: QueryState<QueryResponse>
	breakdown: QueryState<QueryResponse>
	/** Null when the source serves no goal breakdown, so the panel is not rendered at all. */
	goals: QueryState<QueryResponse> | null
}

/** The four reads a view state implies; a null section is one this source cannot serve. */
export interface ViewRequests {
	cards: QueryRequest | null
	trend: QueryRequest | null
	breakdown: QueryRequest | null
	goals: QueryRequest | null
}

/**
 * `QueryState.error.message` for a section with nothing to ask for: the scope has no
 * readable source, or the source serves no metric or dimension the section needs. It is
 * never an endpoint failure, so a caller can tell the two apart without a `QueryFetchError`.
 */
export const SECTION_UNAVAILABLE = 'analytics: this source serves no data for this section'

const NO_REQUESTS: ViewRequests = { cards: null, trend: null, breakdown: null, goals: null }

/**
 * Derives the four reads from the view state and the selected source's capabilities.
 * Pure and total: the state is coerced to what the source serves first, so no request
 * here can carry a metric, dimension, filter, bucket or comparison the endpoint would
 * reject. `now` is injected to keep callers deterministic.
 */
export const buildViewRequests = (
	props: AnalyticsViewClientProps,
	state: ViewState,
	now: Date
): ViewRequests => {
	const source = resolveSource(props.sources, state.source)
	if (!source) {
		return NO_REQUESTS
	}
	const served = gate(source.capabilities)
	if (served.metrics.length === 0) {
		return NO_REQUESTS
	}
	const view = coerceState(state, served)
	const range = rangeFor(view, props.timezone, now)
	// The resolved id, not the state's: a stale one in the URL would otherwise ask the
	// endpoint for a source that is gone while the gate describes the fallback.
	const shared = {
		from: range.from,
		to: range.to,
		...(view.filters.length > 0 ? { filters: view.filters } : {}),
		source: source.id,
		timezone: props.timezone,
	}
	const compare = view.compare ? ({ compare: 'previous' } as const) : {}
	const breakdownMetrics: MetricKey[] = [
		view.metric,
		...(served.metrics.includes('visitors') && view.metric !== 'visitors'
			? (['visitors'] as const)
			: []),
	]
	const dimension = served.dimensionsFor(view.tab)[0]
	const order: QueryRequest['order'] =
		view.order !== undefined && breakdownMetrics.includes(view.order.metric)
			? view.order
			: { metric: view.metric, direction: 'desc' }
	return {
		cards: { metrics: served.metrics, ...shared, ...compare },
		trend: {
			metrics: [view.metric],
			...shared,
			granularity: view.granularity ?? autoGranularity(range, source.capabilities),
			...compare,
		},
		breakdown:
			dimension === undefined
				? null
				: {
						metrics: breakdownMetrics,
						dimensions: [dimension],
						...shared,
						limit: view.limit,
						order,
					},
		goals: served.goals
			? {
					metrics: [
						'conversions',
						...(served.metrics.includes('revenue') ? (['revenue'] as const) : []),
						...(served.metrics.includes('visitors') ? (['visitors'] as const) : []),
					],
					dimensions: ['goal'],
					...shared,
				}
			: null,
	}
}

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

type SectionState = Omit<QueryState<QueryResponse>, 'isRefetching' | 'refetch'>

/**
 * Runs one section's read. The request is keyed by its serialized form, so a state change
 * that leaves a section's query identical never refetches it, and one that changes it
 * aborts the in-flight read before issuing the new one.
 */
const useQuerySection = (
	apiRoute: string,
	request: QueryRequest | null
): QueryState<QueryResponse> => {
	const [section, setSection] = useState<SectionState>({ status: 'loading' })
	const pending = useRef<AbortController | null>(null)
	const key = request === null ? null : JSON.stringify(request)

	const run = useCallback(
		(serialized: string | null) => {
			pending.current?.abort()
			if (serialized === null) {
				pending.current = null
				setSection({ status: 'error', error: new Error(SECTION_UNAVAILABLE) })
				return
			}
			const controller = new AbortController()
			pending.current = controller
			// Returning `prev` unchanged makes the first read a no-op update rather than a
			// second render; any later one keeps what is on screen until the answer lands.
			setSection((prev) =>
				prev.status === 'loading'
					? prev
					: { status: 'loading', ...(prev.data === undefined ? {} : { data: prev.data }) }
			)
			fetchQuery(apiRoute, JSON.parse(serialized) as QueryRequest, {
				signal: controller.signal,
			}).then(
				(data) => {
					if (!controller.signal.aborted) setSection({ status: 'ok', data })
				},
				(err: unknown) => {
					// The failure is reported beside whatever is on screen: a transient 503 on a
					// refetch shows a retry banner over the last good read instead of a blank panel.
					if (!controller.signal.aborted) {
						setSection((prev) => ({
							status: 'error',
							error: asError(err),
							...(prev.data === undefined ? {} : { data: prev.data }),
						}))
					}
				}
			)
		},
		[apiRoute]
	)

	const refetch = useCallback(() => {
		run(key)
	}, [run, key])

	useEffect(() => {
		run(key)
		return () => {
			pending.current?.abort()
		}
	}, [run, key])

	return {
		...section,
		isRefetching: section.status === 'loading' && section.data !== undefined,
		refetch,
	}
}

/**
 * The view's four reads for one state, each with its own lifecycle: a section refetches
 * only when its own request changes, and an in-flight read is aborted when it does.
 */
export const useViewQueries = (props: AnalyticsViewClientProps, state: ViewState): ViewQueries => {
	const requests = buildViewRequests(props, state, new Date())
	const cards = useQuerySection(props.apiRoute, requests.cards)
	const trend = useQuerySection(props.apiRoute, requests.trend)
	const breakdown = useQuerySection(props.apiRoute, requests.breakdown)
	const goals = useQuerySection(props.apiRoute, requests.goals)
	return { cards, trend, breakdown, goals: requests.goals === null ? null : goals }
}
