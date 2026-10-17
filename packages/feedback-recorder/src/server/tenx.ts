import type { ResolvedOptions } from '../types'

export type TenxResult =
	| { ok: true; status: number; body: unknown }
	| { ok: false; status: number; error: TenxFailure; body?: unknown }

/** Why a call to the 10x system did not produce an answer worth passing on. */
export type TenxFailure = 'notConfigured' | 'keyRejected' | 'unreachable' | 'timeout' | 'refused'

export const SUBMITTER_HEADER = 'x-submitter-id'

const readBody = async (response: Response): Promise<unknown> => {
	const text = await response.text().catch(() => '')
	if (!text) return null
	try {
		return JSON.parse(text) as unknown
	} catch {
		return null
	}
}

/**
 * One server-to-server call to the 10x ingest API, with the site's key and a hard deadline. Never
 * throws: a timeout, a refused key or a dead network all come back as a typed failure the endpoint
 * turns into a plain answer for the browser.
 */
export const callTenx = async (input: {
	options: Pick<ResolvedOptions, 'url' | 'apiKey'>
	path: string
	method: 'GET' | 'POST' | 'PUT'
	headers?: Record<string, string>
	body?: BodyInit
	timeoutMs: number
	fetchImpl?: typeof fetch
}): Promise<TenxResult> => {
	const { options } = input
	if (!options.url || !options.apiKey) {
		return { ok: false, status: 503, error: 'notConfigured' }
	}
	const doFetch = input.fetchImpl ?? fetch
	let response: Response
	try {
		response = await doFetch(`${options.url}/api/ingest/v1${input.path}`, {
			method: input.method,
			headers: { ...input.headers, authorization: `Bearer ${options.apiKey}` },
			body: input.body,
			signal: AbortSignal.timeout(input.timeoutMs),
			cache: 'no-store',
		})
	} catch (error) {
		const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
		return { ok: false, status: 504, error: timedOut ? 'timeout' : 'unreachable' }
	}
	const body = await readBody(response)
	if (response.status === 401) return { ok: false, status: 502, error: 'keyRejected', body }
	if (!response.ok) return { ok: false, status: response.status, error: 'refused', body }
	return { ok: true, status: response.status, body }
}
