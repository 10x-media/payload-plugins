import type { AnalyticsFilter, DimensionKey, Granularity, MetricKey } from '../core/contract'
import { readResponseError } from '../plugin/errors'
import { QUERY_PATH, REFRESH_PATH } from '../plugin/paths'
import type { QueryError } from './errors'
import type { QueryResponse } from './response'

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
	timezone?: string
}

const apiBase = (apiRoute: string): string =>
	apiRoute.endsWith('/') ? apiRoute.slice(0, -1) : apiRoute

/**
 * Builds the query endpoint URL from a fixed field order (not object insertion order),
 * so two `QueryRequest`s with the same values always produce the same URL string. That
 * determinism is what `fetchQuery`'s in-flight dedupe keys on.
 */
export const buildQueryUrl = (apiRoute: string, request: QueryRequest): string => {
	const params = new URLSearchParams()
	params.set('metrics', request.metrics.join(','))
	if (request.dimensions && request.dimensions.length > 0) {
		params.set('dimensions', request.dimensions.join(','))
	}
	params.set('from', request.from)
	params.set('to', request.to)
	if (request.granularity !== undefined) {
		params.set('granularity', request.granularity)
	}
	if (request.filters && request.filters.length > 0) {
		params.set('filters', JSON.stringify(request.filters))
	}
	if (request.limit !== undefined) {
		params.set('limit', String(request.limit))
	}
	if (request.order !== undefined) {
		params.set('order', `${request.order.metric}:${request.order.direction}`)
	}
	if (request.compare !== undefined) {
		params.set('compare', request.compare)
	}
	if (request.source !== undefined) {
		params.set('source', request.source)
	}
	if (request.scope !== undefined) {
		params.set('scope', request.scope)
	}
	if (request.path !== undefined) {
		params.set('path', request.path)
	}
	if (request.hostname !== undefined) {
		params.set('hostname', request.hostname)
	}
	if (request.timezone !== undefined) {
		params.set('timezone', request.timezone)
	}
	return `${apiBase(apiRoute)}${QUERY_PATH}?${params.toString()}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/** Thrown by `fetchQuery` for any non-2xx response; `error` is set only when the body parsed as the endpoint's error shape. */
export class QueryFetchError extends Error {
	readonly status: number
	readonly error?: QueryError
	readonly retryAfter?: number

	constructor(status: number, error?: QueryError, retryAfter?: number) {
		super(error?.message ?? `analytics query request failed with status ${status}`)
		this.name = 'QueryFetchError'
		this.status = status
		if (error !== undefined) this.error = error
		if (retryAfter !== undefined) this.retryAfter = retryAfter
	}
}

const readRetryAfter = (res: Response): number | undefined => {
	const header = res.headers.get('Retry-After')
	if (header === null) return undefined
	// The HTTP-date form is not a number, so it yields no delay rather than a bogus one;
	// a fractional delay floors, since callers schedule in whole seconds.
	const seconds = Number(header)
	return Number.isFinite(seconds) ? Math.floor(seconds) : undefined
}

const failure = async (res: Response): Promise<QueryFetchError> =>
	new QueryFetchError(res.status, await readResponseError(res), readRetryAfter(res))

const runFetch = async (url: string): Promise<QueryResponse> => {
	const res = await fetch(url, {
		credentials: 'include',
		headers: { Accept: 'application/json' },
	})
	if (!res.ok) {
		throw await failure(res)
	}
	return (await res.json()) as QueryResponse
}

const inFlight = new Map<string, Promise<QueryResponse>>()

/**
 * Fetches `GET /analytics/query`, deduping concurrent identical requests (same URL) into
 * one underlying fetch; the entry clears on settle (success or failure), so a later call
 * always sees fresh data and a failed one retries instead of pinning the error.
 *
 * Dedupe means the shared fetch itself never carries a caller's `AbortSignal`, since
 * aborting it would also cancel every other caller sharing that in-flight request.
 * `init.signal` instead races the caller's own promise against the abort: aborting
 * rejects that caller without touching the shared fetch. Use distinct requests (varying
 * a param) when one caller's cancellation must actually stop the network call.
 */
export const fetchQuery = (
	apiRoute: string,
	request: QueryRequest,
	init?: { signal?: AbortSignal }
): Promise<QueryResponse> => {
	const url = buildQueryUrl(apiRoute, request)
	let pending = inFlight.get(url)
	if (!pending) {
		pending = runFetch(url).finally(() => {
			inFlight.delete(url)
		})
		inFlight.set(url, pending)
	}

	const signal = init?.signal
	if (!signal) return pending
	if (signal.aborted) return Promise.reject(signal.reason)

	return new Promise<QueryResponse>((resolve, reject) => {
		const onAbort = () => reject(signal.reason)
		signal.addEventListener('abort', onAbort, { once: true })
		pending.then(
			(value) => {
				signal.removeEventListener('abort', onAbort)
				resolve(value)
			},
			(err: unknown) => {
				signal.removeEventListener('abort', onAbort)
				reject(err)
			}
		)
	})
}

/** What `POST /analytics/refresh` answers: the scope's epoch token after the bump. */
export interface RefreshResponse {
	epoch: string
}

export interface RefreshRequest {
	/**
	 * Refresh another scope. Platform readers only: the endpoint answers
	 * `400 untrusted_scope` for any caller that may not read across scopes. Omitted, the
	 * request's own resolved scope is refreshed.
	 */
	scope?: string
	signal?: AbortSignal
}

/**
 * Raises the scope's cache epoch, so every later read of it misses the cache and reaches
 * the provider again. Not deduped, unlike `fetchQuery`: a reader pressing Refresh twice
 * means it twice, and the signal can go straight to the fetch because no other caller
 * shares it. Rejects with a `QueryFetchError` for any non-2xx answer, the same as a read.
 */
export const refreshCache = async (
	apiRoute: string,
	request: RefreshRequest = {}
): Promise<RefreshResponse> => {
	const res = await fetch(`${apiBase(apiRoute)}${REFRESH_PATH}`, {
		method: 'POST',
		credentials: 'include',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		body: JSON.stringify(request.scope === undefined ? {} : { scope: request.scope }),
		...(request.signal === undefined ? {} : { signal: request.signal }),
	})
	if (!res.ok) {
		throw await failure(res)
	}
	const body: unknown = await res.json()
	// The caller acts on the refresh having happened, not on the token, so an answer this
	// client cannot read is reported as the initial token rather than typed into a lie.
	return { epoch: isRecord(body) && typeof body.epoch === 'string' ? body.epoch : '0' }
}
