/**
 * One configured site address as the exclusion endpoint answers it: an `http(s)` origin with its
 * path and nothing after, or null for anything else.
 */
export const siteAddress = (candidate: unknown): string | null => {
	if (typeof candidate !== 'string') {
		return null
	}
	let url: URL
	try {
		url = new URL(candidate)
	} catch {
		return null
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return null
	}
	return `${url.origin}${url.pathname}`
}
