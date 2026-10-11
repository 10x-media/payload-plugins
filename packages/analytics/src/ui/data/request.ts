import {
	type AnalyticsError,
	type AnalyticsErrorCode,
	readResponseError,
} from '../../plugin/errors'

/**
 * Thrown for any non-2xx answer from an analytics endpoint. Branch on `code`, set only when the body
 * was the endpoint's envelope, and fall back to `status`.
 */
export class QueryFetchError extends Error {
	readonly status: number
	readonly error?: AnalyticsError
	readonly code?: AnalyticsErrorCode
	readonly retryAfter?: number

	constructor(status: number, error?: AnalyticsError, retryAfter?: number) {
		super(error?.message ?? `analytics query request failed with status ${status}`)
		this.name = 'QueryFetchError'
		this.status = status
		if (error !== undefined) {
			this.error = error
			this.code = error.code
		}
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

/** The error a refused answer stands for, its envelope read when the body is one. */
const responseFailure = async (res: Response): Promise<QueryFetchError> =>
	new QueryFetchError(res.status, await readResponseError(res), readRetryAfter(res))

export interface RequestOptions {
	method?: 'GET' | 'POST'
	/** Sent as JSON. */
	body?: unknown
	signal?: AbortSignal
}

/**
 * One request to an analytics endpoint as every admin surface makes it, resolving the parsed body. A
 * refusal throws a {@link QueryFetchError}; a network failure or abort propagates as itself.
 */
export const requestJson = async (url: string, options: RequestOptions = {}): Promise<unknown> => {
	const { method = 'GET', body, signal } = options
	const res = await fetch(url, {
		method,
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		...(signal === undefined ? {} : { signal }),
	})
	if (!res.ok) {
		throw await responseFailure(res)
	}
	return res.json()
}

/**
 * One request whose answer must pass `guard`: any other shape is refused like a failed request, so
 * the caller degrades rather than reading a missing field.
 */
export const requestShaped = async <T>(
	url: string,
	guard: (value: unknown) => value is T,
	options: RequestOptions = {}
): Promise<T> => {
	const body = await requestJson(url, options)
	if (!guard(body)) {
		throw new Error(`analytics: ${url.split('?')[0]} answered in an unexpected shape`)
	}
	return body
}

/** Whether `err` is the rejection of an aborted request rather than a failure worth showing. */
export const isAbortError = (err: unknown): boolean =>
	(err instanceof DOMException || err instanceof Error) && err.name === 'AbortError'

/**
 * Why a section has nothing to show, by what the reader can do about it. `unsupported` is no failure:
 * the source serves nothing this section reads.
 *
 * @beta
 */
export type RequestFailure =
	| { code: 'unsupported' }
	| { code: 'invalid_param'; param?: string }
	| { code: 'range_too_long' }
	| { code: 'source_misconfigured'; hostRefused: boolean }
	| { code: 'unavailable'; retryAfter?: number }
	| { code: 'rate_limited'; retryAfter?: number }
	| { code: 'not_found' }
	| { code: 'forbidden' }
	| { code: 'failed' }

const INVALID: ReadonlySet<AnalyticsErrorCode> = new Set<AnalyticsErrorCode>([
	'invalid_param',
	'unsupported_metric',
	'unsupported_dimension',
	'unsupported_filter',
	'unsupported_operator',
	'unsupported_granularity',
	'payload_too_large',
])

/** The wait a refusal named, in seconds, ready to spread into what reports it. */
export const retryOf = (err: QueryFetchError): { retryAfter?: number } =>
	err.retryAfter === undefined ? {} : { retryAfter: err.retryAfter }

const byStatus = (err: QueryFetchError): RequestFailure => {
	if (err.status === 401 || err.status === 403) return { code: 'forbidden' }
	if (err.status === 404) return { code: 'not_found' }
	if (err.status === 429) return { code: 'rate_limited', ...retryOf(err) }
	if (err.status === 503) return { code: 'unavailable', ...retryOf(err) }
	return { code: 'failed' }
}

/** What a thrown request failure means for the section that made it. */
export const failureOf = (err: unknown): RequestFailure => {
	if (!(err instanceof QueryFetchError)) {
		return { code: 'failed' }
	}
	const code = err.code
	if (code === undefined || code === 'internal') {
		return byStatus(err)
	}
	if (code === 'range_too_long') {
		return { code: 'range_too_long' }
	}
	if (INVALID.has(code)) {
		return err.error?.param === undefined
			? { code: 'invalid_param' }
			: { code: 'invalid_param', param: err.error.param }
	}
	switch (code) {
		case 'source_misconfigured':
			return { code: 'source_misconfigured', hostRefused: err.error?.param === 'host' }
		case 'unavailable':
			return { code: 'unavailable', ...retryOf(err) }
		case 'rate_limited':
			return { code: 'rate_limited', ...retryOf(err) }
		case 'not_found':
		case 'unknown_source':
			return { code: 'not_found' }
		case 'unauthorized':
		case 'forbidden':
		case 'untrusted_scope':
			return { code: 'forbidden' }
		default:
			return byStatus(err)
	}
}
