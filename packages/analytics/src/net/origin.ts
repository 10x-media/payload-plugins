/** Why a value is not an address the plugin accepts: malformed, or http where https is due. */
export type OriginProblem = 'format' | 'insecure'

const urlOf = (value: string): URL | null => {
	try {
		return new URL(value.trim())
	} catch {
		return null
	}
}

const isHttp = (url: URL): boolean => url.protocol === 'https:' || url.protocol === 'http:'

/** `value` as an http(s) URL with no credentials, query or fragment; http only with `allowHttp`. */
export const parseHttpUrl = (
	value: string,
	allowHttp: boolean
): URL | { problem: OriginProblem } => {
	const url = urlOf(value)
	if (!url) {
		return { problem: 'format' }
	}
	if (url.protocol === 'http:' && !allowHttp) {
		return { problem: 'insecure' }
	}
	if (!isHttp(url)) {
		return { problem: 'format' }
	}
	if (url.username || url.password || url.search || url.hash) {
		return { problem: 'format' }
	}
	return url
}

/**
 * The origin `value` names when it is nothing but one: a scheme, a host and maybe a port, with no
 * credentials, path, query, fragment or wildcard. `http` only when `allowHttp`.
 */
export const parseOrigin = (
	value: string,
	allowHttp: boolean
): { origin: string } | { problem: OriginProblem } => {
	if (value.includes('*')) {
		return { problem: 'format' }
	}
	const url = parseHttpUrl(value, allowHttp)
	if (!(url instanceof URL)) {
		return url
	}
	return url.pathname === '/' ? { origin: url.origin } : { problem: 'format' }
}

/**
 * An origin as a browser writes `Origin`: lowercased, default port dropped. Null for anything not
 * http(s), the literal `null` of an opaque document included.
 */
export const normalizeOrigin = (value: string): string | null => {
	const url = urlOf(value)
	return url && isHttp(url) ? url.origin : null
}
