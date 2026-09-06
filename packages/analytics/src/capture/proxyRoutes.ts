import { compile, match } from 'path-to-regexp'
import type { ProxyRoute } from '../core/capture'

/** Request headers every vendor proxy forwards upstream. */
export const FORWARDED_REQUEST_HEADERS = [
	'content-type',
	'accept',
	'accept-encoding',
	'accept-language',
	'user-agent',
	'origin',
	'referer',
	'if-none-match',
	'if-modified-since',
]

/**
 * Never forwarded, whatever a descriptor's `forwardHeaders` asks for: credentials
 * the vendor has no business seeing, and the forwarding chain the proxy sets itself.
 */
const NEVER_FORWARDED_REQUEST_HEADERS = new Set([
	'cookie',
	'authorization',
	'proxy-authorization',
	'host',
	'forwarded',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-forwarded-proto',
	'x-real-ip',
])

/**
 * The only upstream response headers passed back. `content-encoding` and
 * `content-length` are deliberately absent: fetch decodes the body but leaves both
 * describing the compressed bytes, so forwarding either corrupts the response.
 */
export const FORWARDED_RESPONSE_HEADERS = [
	'content-type',
	'cache-control',
	'etag',
	'last-modified',
	'vary',
]

export interface ProxyMatch {
	upstreamUrl: URL
}

export interface MatchProxyRouteOptions {
	/** `ProxyDescriptor.trailingSlashes`: keep a request's trailing slash upstream. */
	trailingSlashes?: boolean
}

const isSafeUpstream = (url: URL): boolean => url.protocol === 'https:' || url.protocol === 'http:'

// encodeURIComponent escapes every RFC 3986 sub-delim plus ':' and '@', all of which are
// legal inside a path segment, so a vendor URL would not round-trip byte for byte. Restore
// exactly those; '/', '?' and '#' stay escaped because they would change the URL's shape.
const PATH_SAFE_ESCAPES = /%(24|26|2B|2C|3A|3B|3D|40)/gi

const encodeSegment = (segment: string): string =>
	encodeURIComponent(segment).replace(PATH_SAFE_ESCAPES, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16))
	)

const paramSegments = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []

/** A dot segment would collapse when assigned to `URL.pathname`, escaping the route prefix. */
const hasDotSegment = (params: Record<string, unknown>): boolean =>
	Object.values(params)
		.flatMap(paramSegments)
		.some((segment) => segment === '.' || segment === '..')

/**
 * First declared route whose `source` matches `path` (percent-encoded, relative to the
 * slot mount), compiled into its absolute upstream URL. Null when no route matches, so
 * the caller answers 404: an upstream URL only ever comes from a descriptor template,
 * never from the request.
 */
export const matchProxyRoute = (
	routes: ProxyRoute[],
	path: string,
	options: MatchProxyRouteOptions = {}
): ProxyMatch | null => {
	for (const route of routes) {
		let template: URL
		try {
			template = new URL(route.upstream)
		} catch {
			continue
		}
		if (!isSafeUpstream(template)) {
			continue
		}
		const matched = match(route.source, { decode: decodeURIComponent })(path)
		if (!matched) {
			continue
		}
		const params = matched.params as Record<string, unknown>
		if (hasDotSegment(params)) {
			return null
		}
		let compiled: string
		try {
			compiled = compile(template.pathname, { encode: encodeSegment })(params)
		} catch {
			// A template naming a param its source never produces is a broken descriptor,
			// not a request the client can fix: skip it rather than throwing a public 500.
			continue
		}
		// path-to-regexp drops the trailing slash a wildcard consumed. Only a descriptor
		// that asks for it gets it back, because only PostHog's capture endpoints need it.
		const keepSlash =
			options.trailingSlashes === true && path.endsWith('/') && !compiled.endsWith('/')
		const upstreamUrl = new URL(template.href)
		upstreamUrl.pathname = compiled === '' ? '/' : `${compiled}${keepSlash ? '/' : ''}`
		return { upstreamUrl }
	}
	return null
}

/**
 * The headers the upstream request carries: the allowlist plus a descriptor's own
 * extras, and `X-Forwarded-For` from the resolved client IP so vendor geo stays
 * correct. An absent IP sends no header rather than a fabricated one.
 */
export const buildUpstreamHeaders = (
	incoming: Headers,
	clientIp: string | null,
	extra: string[] = []
): Headers => {
	const out = new Headers()
	const names = [...FORWARDED_REQUEST_HEADERS, ...extra.map((name) => name.toLowerCase())]
	for (const name of names) {
		if (NEVER_FORWARDED_REQUEST_HEADERS.has(name)) {
			continue
		}
		const value = incoming.get(name)
		if (value !== null) {
			out.set(name, value)
		}
	}
	if (clientIp) {
		out.set('x-forwarded-for', clientIp)
	}
	return out
}

/** The headers the client sees: the response allowlist, so `set-cookie` can never pass. */
export const buildDownstreamHeaders = (upstream: Headers): Headers => {
	const out = new Headers()
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		const value = upstream.get(name)
		if (value !== null) {
			out.set(name, value)
		}
	}
	return out
}
