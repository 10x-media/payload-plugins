import type { SerializedCapabilities } from '../../core/capabilities'
import { readResponseError } from '../../plugin/errors'
import { SOURCES_PATH } from '../../plugin/paths'

export interface WireSource {
	id: string
	label: string
	kind: 'config' | 'runtime'
	capabilities: SerializedCapabilities
}

export interface SourcesResponse {
	defaultId: string | null
	sources: WireSource[]
}

const cache = new Map<string, Promise<SourcesResponse>>()

/**
 * Fetch the caller-scope source list once per user per admin session and share
 * it between every picker instance on the page; a failed fetch clears its cache
 * entry so a later mount retries instead of pinning the error. Keying by user
 * id keeps a soft-navigation logout/login from serving the previous user's
 * cached sources.
 */
export const fetchSources = (
	serverURL: string,
	apiRoute: string,
	userKey: string
): Promise<SourcesResponse> => {
	const url = `${serverURL}${apiRoute}${SOURCES_PATH}`
	const key = `${userKey}:${url}`
	const hit = cache.get(key)
	if (hit) return hit
	const p = fetch(url, { credentials: 'include' })
		.then(async (res) => {
			if (!res.ok) {
				// The picker shows one failed state either way, so the code rides in the message
				// rather than inventing a second: a denied listing and a down one read alike in
				// the console otherwise.
				const code = (await readResponseError(res))?.code
				throw new Error(`analytics: sources ${res.status}${code ? ` ${code}` : ''}`)
			}
			return (await res.json()) as SourcesResponse
		})
		.catch((err) => {
			cache.delete(key)
			throw err
		})
	cache.set(key, p)
	return p
}
