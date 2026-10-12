import { compile, match } from 'path-to-regexp'
import type { ProxyRoute, ProxyRouteKind } from '../core/capture'
import { VISITOR_HEADERS } from '../net/platform'

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
 * Never forwarded, whatever `forwardHeaders` asks: credentials, the forwarding chain the proxy sets
 * itself, and platform headers about the visitor's address or location.
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
	...VISITOR_HEADERS,
])

/**
 * The upstream response headers passed back as they came. Not `content-encoding` or
 * `content-length`: fetch decodes the body but leaves both describing the compressed bytes.
 */
const FORWARDED_RESPONSE_HEADERS = ['cache-control', 'etag', 'last-modified', 'vary']

/**
 * The validators and freshness a data route never passes on: its answer is about one visitor, so
 * no cache between the site and the browser may keep it, whatever the vendor said.
 */
const SCRIPT_ONLY_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
	'cache-control',
	'etag',
	'last-modified',
])

/** What every data route answers with in place of the vendor's own caching headers. */
export const DATA_CACHE_CONTROL = 'private, no-store'

/** What a script route is always served as, whatever the vendor labelled it. */
export const SCRIPT_CONTENT_TYPE = 'text/javascript; charset=utf-8'

/** What a data route answer becomes unless the vendor sent JSON or plain text. */
export const DATA_FALLBACK_CONTENT_TYPE = 'text/plain; charset=utf-8'

/** A data answer can never be a document of this origin, even one a browser opens directly. */
export const DATA_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'"

const DATA_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/json', 'text/plain'])

export interface ProxyMatch {
	upstreamUrl: URL
	kind: ProxyRouteKind
}

export interface MatchProxyRouteOptions {
	/** `ProxyDescriptor.trailingSlashes`: keep a request's trailing slash upstream. */
	trailingSlashes?: boolean
}

const isSafeUpstream = (url: URL): boolean => url.protocol === 'https:' || url.protocol === 'http:'

// encodeURIComponent escapes sub-delims, ':' and '@', all legal in a segment, so those come
// back; '/', '?' and '#' would reshape the URL, and some upstreams split on ';'.
const PATH_SAFE_ESCAPES = /%(24|26|2B|2C|3A|3D|40)/gi

const encodeSegment = (segment: string): string =>
	encodeURIComponent(segment).replace(PATH_SAFE_ESCAPES, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16))
	)

const paramSegments = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []

/**
 * A segment that could leave the route prefix: a dot segment collapses when assigned to
 * `URL.pathname`, and an encoded `/` or `\` is a separator to an upstream that decodes it.
 */
const escapesRoute = (params: Record<string, unknown>): boolean =>
	Object.values(params)
		.flatMap(paramSegments)
		.some(
			(segment) =>
				segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')
		)

/**
 * The first route whose `source` matches `path`, compiled into its upstream URL, or null for a 404:
 * an upstream URL only ever comes from a descriptor template, never from the request.
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
		const matched = match<Record<string, unknown>>(route.source, { decode: decodeURIComponent })(
			path
		)
		if (!matched) {
			continue
		}
		const { params } = matched
		if (escapesRoute(params)) {
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
		return { upstreamUrl, kind: route.kind }
	}
	return null
}

/**
 * The allowlist plus a descriptor's extras, and `X-Forwarded-For` from the resolved client IP so
 * vendor geo stays right; an absent IP sends no header rather than a fabricated one.
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

/** A JSON or plain-text type as the vendor wrote it; anything else, or nothing, as plain text. */
const dataContentType = (value: string | null): string => {
	const media = value?.split(';')[0]?.trim().toLowerCase()
	return value !== null && media !== undefined && DATA_CONTENT_TYPES.has(media)
		? value
		: DATA_FALLBACK_CONTENT_TYPE
}

/**
 * The response allowlist (so `set-cookie` never passes) and a content type the route's kind decides.
 * A data route is sandboxed and uncached, so an upstream answering HTML cannot put a page on the site.
 */
export const buildDownstreamHeaders = (upstream: Headers, kind: ProxyRouteKind): Headers => {
	const out = new Headers()
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		if (kind === 'data' && SCRIPT_ONLY_RESPONSE_HEADERS.has(name)) {
			continue
		}
		const value = upstream.get(name)
		if (value !== null) {
			out.set(name, value)
		}
	}
	out.set('x-content-type-options', 'nosniff')
	if (kind === 'script') {
		out.set('content-type', SCRIPT_CONTENT_TYPE)
	} else {
		out.set('content-type', dataContentType(upstream.get('content-type')))
		out.set('cache-control', DATA_CACHE_CONTROL)
		out.set('content-security-policy', DATA_CONTENT_SECURITY_POLICY)
	}
	return out
}
