'use client'

import { metricReaches } from '../core/capabilities'
import { type DimensionKey, type MetricKey, PLATFORM_SCOPE } from '../core/contract'
import { fetchQuery, type QueryRequest } from '../query/fetchQuery'
import type { QueryResponse } from '../query/response'
import { type RequestState, useRequest } from '../ui/data/useRequest'
import { autoGranularity, canCompareRange, gate, RATE_DIMENSIONS, resolveSource } from './gating'
import { coerceState, rangeFor, type ViewState } from './state'
import type { AnalyticsViewClientProps } from './viewProps'

/**
 * One section's read. `data` survives loading and errors while source and scope hold, so a range
 * change dims the chart rather than blanking it; another source or scope starts from a skeleton.
 *
 * @beta
 */
export type QueryState<T> = RequestState<T>

/** @beta */
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

const NO_REQUESTS: ViewRequests = { cards: null, trend: null, breakdown: null, goals: null }

/**
 * Four reads from view state and source capabilities. State is coerced to what the source serves
 * first, so no request carries anything the endpoint would reject.
 */
const buildViewRequests = (
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
		// The bare marker: the token's tenant tag is the view's own bookkeeping, and whether the
		// reader may read it is the endpoint's call alone, so a refusal comes from there.
		...(view.scope === undefined ? {} : { scope: PLATFORM_SCOPE }),
		timezone: props.timezone,
		...(view.range === 'custom' ? {} : { timeframe: view.range }),
	}
	const compare =
		view.compare && canCompareRange(served, range, { timezone: props.timezone, now })
			? ({ compare: 'previous' } as const)
			: {}
	// The coerced state only carries a `dim` the tab actually offers, so the picked one can
	// be taken as-is and the tab's default is the fallback.
	const dimension = view.dim ?? served.dimensionsFor(view.tab)[0]
	const columns = dimension === undefined ? [] : served.metricsFor(dimension, view.metric)
	// The rate column divides the row's own visitors by the site's, so the read carries
	// visitors even where the breakdown does not show them as a column of their own.
	const reachesUnder = (metric: MetricKey, under: DimensionKey): boolean =>
		served.metrics.includes(metric) &&
		metricReaches(source.capabilities, metric, { dimensions: [under] })
	const needsVisitors =
		dimension !== undefined &&
		RATE_DIMENSIONS.includes(dimension) &&
		reachesUnder('visitors', dimension)
	const breakdownMetrics: MetricKey[] = [
		...new Set([...columns, ...(needsVisitors ? (['visitors'] as const) : [])]),
	]
	const order: QueryRequest['order'] =
		view.order !== undefined && breakdownMetrics.includes(view.order.metric)
			? view.order
			: { metric: columns[0] ?? view.metric, direction: 'desc' }
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
						...(reachesUnder('revenue', 'goal') ? (['revenue'] as const) : []),
						...(reachesUnder('visitors', 'goal') ? (['visitors'] as const) : []),
					],
					dimensions: ['goal'],
					...shared,
				}
			: null,
	}
}

/**
 * Identity of a section's answer (source and scope). A read under another identity starts empty,
 * so a source switch never shows the last source's numbers under the new one's name.
 */
export const answerIdentity = (
	props: Pick<AnalyticsViewClientProps, 'sources' | 'scopeKey'>,
	state: Pick<ViewState, 'source' | 'scope'>
): string => {
	const source = resolveSource(props.sources, state.source)
	return `${source?.id ?? ''}|${state.scope ?? ''}|${props.scopeKey}`
}

/**
 * One section's read through the query endpoint, keyed by its serialized request and the scope
 * it reads for, which the request itself does not name.
 */
const useQuerySection = (
	endpoint: string,
	request: QueryRequest | null,
	at: { keep: string; scope: string }
): QueryState<QueryResponse> =>
	useRequest({
		key: request === null ? null : JSON.stringify([at.scope, request]),
		run: ({ signal }) =>
			request === null
				? Promise.reject(new Error('no request'))
				: fetchQuery(endpoint, request, { signal, scope: at.scope }),
		keep: at.keep,
	})

/**
 * The four reads, each with its own lifecycle: a section refetches only when its request changes,
 * aborting any read in flight. `now` is the view's one clock, so reads cover the captioned days.
 */
export const useViewQueries = (
	props: AnalyticsViewClientProps,
	state: ViewState,
	now: Date
): ViewQueries => {
	const requests = buildViewRequests(props, state, now)
	const at = { keep: answerIdentity(props, state), scope: props.scopeKey }
	const cards = useQuerySection(props.endpoints.query, requests.cards, at)
	const trend = useQuerySection(props.endpoints.query, requests.trend, at)
	const breakdown = useQuerySection(props.endpoints.query, requests.breakdown, at)
	const goals = useQuerySection(props.endpoints.query, requests.goals, at)
	return { cards, trend, breakdown, goals: requests.goals === null ? null : goals }
}
