import type { AnalyticsFilter, DimensionKey, Granularity, MetricKey } from '../core/contract'
import { isRecord } from '../core/values'
import { DEFAULT_ROUTE_BASE, routePaths } from '../plugin/routes'
import type { TimeframePreset } from '../timeframe/presets'
import { requestJson, requestShaped } from '../ui/data/request'
import { isQueryResponse, type QueryResponse } from './response'

export { QueryFetchError } from '../ui/data/request'

/** A client-side mirror of the parameters `parseQueryParams` reads off the request. */
export interface QueryRequest {
	metrics: MetricKey[]
	dimensions?: DimensionKey[]
	from: string
	to: string
	granularity?: Granularity
	filters?: AnalyticsFilter[]
	limit?: number
	order?: { metric: MetricKey; direction: 'asc' | 'desc' }
	compare?: 'previous'
	source?: string
	/**
	 * Read another scope's data. Platform readers only: the endpoint answers
	 * `400 untrusted_scope` for any caller that may not read across scopes.
	 */
	scope?: string
	path?: string
	hostname?: string
	/** One content item's ref; only a source serving `perItemQuery` accepts it. */
	item?: string
	timezone?: string
	/** The preset the range was resolved from, so the read can be kept warm; omitted when custom. */
	timeframe?: TimeframePreset
}

const DEFAULT_ROUTES = routePaths(DEFAULT_ROUTE_BASE)

/**
 * The endpoint a caller named: its own URL, which ends in the endpoint's segment whatever the
 * base, or the API route alone (`/api`), which gets the default mount appended.
 */
const endpointOf = (given: string, route: 'query' | 'refresh'): string => {
	const trimmed = given.replace(/\/+$/, '')
	return trimmed.endsWith(`/${route}`) ? trimmed : `${trimmed}${DEFAULT_ROUTES[route]}`
}

/**
 * The URL of one read, its fields in a fixed order so `fetchQuery`'s dedupe can key on it. Takes the
 * endpoint's URL, or the API route alone, which reads from the default mount.
 */
export const buildQueryUrl = (endpoint: string, request: QueryRequest): string => {
	const params = new URLSearchParams()
	const put = (name: string, value: string | undefined): void => {
		if (value !== undefined) {
			params.set(name, value)
		}
	}
	const { dimensions, filters, limit, order } = request
	put('metrics', request.metrics.join(','))
	put('dimensions', dimensions && dimensions.length > 0 ? dimensions.join(',') : undefined)
	put('from', request.from)
	put('to', request.to)
	put('granularity', request.granularity)
	put('filters', filters && filters.length > 0 ? JSON.stringify(filters) : undefined)
	put('limit', limit === undefined ? undefined : String(limit))
	put('order', order === undefined ? undefined : `${order.metric}:${order.direction}`)
	put('compare', request.compare)
	put('source', request.source)
	put('scope', request.scope)
	put('path', request.path)
	put('hostname', request.hostname)
	put('item', request.item)
	put('timezone', request.timezone)
	put('timeframe', request.timeframe)
	return `${endpointOf(endpoint, 'query')}?${params.toString()}`
}

const runFetch = (url: string, signal: AbortSignal): Promise<QueryResponse> =>
	requestShaped(url, isQueryResponse, { signal })

/** One fetch every identical concurrent read shares, and who is still waiting on it. */
interface SharedFetch {
	promise: Promise<QueryResponse>
	controller: AbortController
	/** Callers that brought a signal and have neither aborted nor been answered. */
	waiting: number
	/** A caller brought no signal, so it can never abort: the fetch runs to its end. */
	held: boolean
}

const inFlight = new Map<string, SharedFetch>()

/** Drops `shared` from the map unless a newer fetch already took its key. */
const forget = (key: string, shared: SharedFetch): void => {
	if (inFlight.get(key) === shared) {
		inFlight.delete(key)
	}
}

const sharedFetch = (key: string, url: string): SharedFetch => {
	const existing = inFlight.get(key)
	if (existing) {
		return existing
	}
	const controller = new AbortController()
	const created: SharedFetch = {
		controller,
		waiting: 0,
		held: false,
		promise: runFetch(url, controller.signal).finally(() => forget(key, created)),
	}
	inFlight.set(key, created)
	return created
}

export interface FetchQueryInit {
	signal?: AbortSignal
	/**
	 * Reader's request scope (view's `scopeKey`, a picker's `useRequestScope`): reads of one URL for
	 * different scopes never share a fetch, so a tenant switch cannot leak an answer.
	 */
	scope?: string
}

/**
 * Shares one fetch among concurrent identical reads (same scope and URL) until it settles. An abort
 * rejects only its caller; the fetch aborts once every sharer has and none lacks a signal.
 */
export const fetchQuery = (
	endpoint: string,
	request: QueryRequest,
	init?: FetchQueryInit
): Promise<QueryResponse> => {
	const url = buildQueryUrl(endpoint, request)
	const signal = init?.signal
	if (signal?.aborted) {
		return Promise.reject(signal.reason)
	}
	const key = JSON.stringify([init?.scope ?? '', url])
	const fetching = sharedFetch(key, url)
	if (!signal) {
		fetching.held = true
		return fetching.promise
	}
	fetching.waiting += 1
	return new Promise<QueryResponse>((resolve, reject) => {
		let done = false
		const settle = (): boolean => {
			if (done) {
				return false
			}
			done = true
			fetching.waiting -= 1
			signal.removeEventListener('abort', onAbort)
			return true
		}
		const onAbort = (): void => {
			if (!settle()) {
				return
			}
			if (fetching.waiting === 0 && !fetching.held) {
				forget(key, fetching)
				fetching.controller.abort(signal.reason)
			}
			reject(signal.reason)
		}
		signal.addEventListener('abort', onAbort, { once: true })
		fetching.promise.then(
			(value) => {
				if (settle()) {
					resolve(value)
				}
			},
			(err: unknown) => {
				if (settle()) {
					reject(err)
				}
			}
		)
	})
}

/** What the refresh endpoint answers: the scope's epoch token after the bump. */
export interface RefreshResponse {
	epoch: string
}

export interface RefreshRequest {
	/**
	 * Refresh another scope (platform readers only; others get `400 untrusted_scope`). Omitted, the
	 * request's own resolved scope is refreshed.
	 */
	scope?: string
	signal?: AbortSignal
}

/**
 * Raises the scope's cache epoch through the refresh endpoint (or the API route alone), never
 * deduped: Refresh pressed twice means it twice. Rejects with a `QueryFetchError` on non-2xx.
 */
export const refreshCache = async (
	endpoint: string,
	request: RefreshRequest = {}
): Promise<RefreshResponse> => {
	const body = await requestJson(endpointOf(endpoint, 'refresh'), {
		method: 'POST',
		body: request.scope === undefined ? {} : { scope: request.scope },
		...(request.signal === undefined ? {} : { signal: request.signal }),
	})
	// The caller acts on the refresh having happened, not on the token, so an answer this
	// client cannot read is reported as the initial token rather than typed into a lie.
	return { epoch: isRecord(body) && typeof body.epoch === 'string' ? body.epoch : '0' }
}
