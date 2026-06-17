export class ProviderHttpError extends Error {
	readonly status: number
	readonly provider: string
	constructor(status: number, provider: string, message: string) {
		super(message)
		this.name = 'ProviderHttpError'
		this.status = status
		this.provider = provider
	}
}

export interface FetchJsonOptions {
	method?: 'GET' | 'POST'
	headers?: Record<string, string>
	body?: unknown
	signal?: AbortSignal
	provider: string
}

/**
 * Thin JSON fetch used by provider adapters. Throws ProviderHttpError (carrying the
 * status) on a non-2xx response so the surfacing engine's queue can treat it as a
 * failed fetch; the engine owns retry/backoff and caching.
 */
export const fetchJson = async <T>(url: string, opts: FetchJsonOptions): Promise<T> => {
	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers: {
			...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
			...opts.headers,
		},
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		signal: opts.signal,
	})
	if (!res.ok) {
		const detail = await res.text().catch(() => '')
		throw new ProviderHttpError(
			res.status,
			opts.provider,
			`${opts.provider}: HTTP ${res.status} ${detail.slice(0, 200)}`
		)
	}
	return (await res.json()) as T
}
