import type { FetchLike } from '../../core/fetch'
import { BREAKER_MAX_MS } from '../../surfacing/breaker'

export class ProviderHttpError extends Error {
	readonly status: number
	readonly provider: string
	/** The vendor's `Retry-After`, in milliseconds from when the answer arrived; absent when it sent none. */
	readonly retryAfterMs?: number
	constructor(
		status: number,
		provider: string,
		detail: string | { message: string; retryAfterMs?: number }
	) {
		super(typeof detail === 'string' ? detail : detail.message)
		this.name = 'ProviderHttpError'
		this.status = status
		this.provider = provider
		if (typeof detail !== 'string' && detail.retryAfterMs !== undefined) {
			this.retryAfterMs = detail.retryAfterMs
		}
	}
}

/**
 * A `Retry-After` (whole seconds or an HTTP date) in ms from `now`, capped at the breaker's longest
 * wait; anything else reads as absent. `now` is the real clock: the vendor stamped the date.
 */
export const parseRetryAfter = (
	value: string | null | undefined,
	now: number = Date.now()
): number | undefined => {
	const text = value?.trim()
	if (!text) {
		return undefined
	}
	if (/^\d+$/.test(text)) {
		return Math.min(Number(text) * 1000, BREAKER_MAX_MS)
	}
	// Every HTTP date form names its month in letters; a bare number Date.parse would read as a year.
	const at = /[a-z]/i.test(text) ? Date.parse(text) : Number.NaN
	return Number.isNaN(at) ? undefined : Math.min(Math.max(0, at - now), BREAKER_MAX_MS)
}

export interface FetchJsonOptions {
	method?: 'GET' | 'POST'
	headers?: Record<string, string>
	body?: unknown
	signal?: AbortSignal
	provider: string
	/** Reaches the vendor; the global fetch unless the adapter was handed another. */
	fetch?: FetchLike
}

/**
 * Thin JSON fetch used by provider adapters. Throws ProviderHttpError (carrying the status and
 * any `Retry-After`) on a non-2xx response; the surfacing engine owns retries, pauses and caching.
 * The body is taken as `T` unchecked, so `T` states the vendor's documented answer.
 */
export const fetchJson = async <T>(url: string, opts: FetchJsonOptions): Promise<T> => {
	const send: FetchLike = opts.fetch ?? fetch
	const res = await send(url, {
		method: opts.method ?? 'GET',
		headers: {
			...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
			...opts.headers,
		},
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		signal: opts.signal,
	})
	if (!res.ok) {
		const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'))
		const detail = await res.text().catch(() => '')
		throw new ProviderHttpError(res.status, opts.provider, {
			message: `${opts.provider}: HTTP ${res.status} ${detail.slice(0, 200)}`,
			...(retryAfterMs === undefined ? {} : { retryAfterMs }),
		})
	}
	return (await res.json()) as T
}
