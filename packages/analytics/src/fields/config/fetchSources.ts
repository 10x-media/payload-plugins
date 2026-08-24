import type { SerializedCapabilities } from '../../core/capabilities'
import { SOURCES_PATH } from '../../plugin/paths'

export interface WireSource {
	id: string
	label: string
	capabilities: SerializedCapabilities
}

const cache = new Map<string, Promise<WireSource[]>>()

/**
 * Fetch the caller-scope source list once per admin session and share it
 * between every picker instance on the page; a failed fetch clears its cache
 * entry so a later mount retries instead of pinning the error.
 */
export const fetchSources = (serverURL: string, apiRoute: string): Promise<WireSource[]> => {
	const url = `${serverURL}${apiRoute}${SOURCES_PATH}`
	const hit = cache.get(url)
	if (hit) return hit
	const p = fetch(url, { credentials: 'include' })
		.then((res) => {
			if (!res.ok) throw new Error(`sources ${res.status}`)
			return res.json() as Promise<{ sources: WireSource[] }>
		})
		.then((body) => body.sources)
		.catch((err) => {
			cache.delete(url)
			throw err
		})
	cache.set(url, p)
	return p
}
