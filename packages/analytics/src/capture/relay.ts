import type { ProxyDescriptor } from '../core/capture'
import type { FetchLike } from '../core/fetch'
import { type ClientIpOptions, clientIpFromHeaders } from '../native/ingest/clientIp'
import { buildDownstreamHeaders, buildUpstreamHeaders, matchProxyRoute } from './proxyRoutes'
import { type CappedBodySource, readCappedBody } from './requestBody'

/** Deadline for the upstream response headers, not for the body download. */
export const DEFAULT_PROXY_TIMEOUT_MS = 10_000

/** PostHog batches carrying session-replay data routinely exceed 64 KB. */
export const DEFAULT_PROXY_MAX_BODY_BYTES = 1024 * 1024

const ALLOWED_METHODS = 'GET, POST, OPTIONS'

const SERVED_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'OPTIONS'])

/** A script route only ever serves the vendor's bundle: nothing is posted to it. */
const SCRIPT_METHODS = 'GET, OPTIONS'

/**
 * A relay's only error answer, and no error envelope: it relays a vendor SDK's own traffic, and that
 * SDK, not admin code, reads the answer.
 */
export const emptyResponse = (status: number, headers: Record<string, string> = {}): Response =>
	new Response(null, { status, headers: { ...headers, 'x-content-type-options': 'nosniff' } })

/**
 * The answer to an upper-case method a relay never forwards: 405 for one it does not serve, 204 for a
 * preflight. Null for GET and POST. The tracker is same-origin, so a preflight never reaches a real
 * deployment, and answering it locally beats forwarding one and stripping the CORS headers it asks for.
 */
export const unforwardedMethodResponse = (method: string): Response | null => {
	if (!SERVED_METHODS.has(method)) {
		return emptyResponse(405, { allow: ALLOWED_METHODS })
	}
	return method === 'OPTIONS' ? emptyResponse(204, { allow: ALLOWED_METHODS }) : null
}

/**
 * The path below `mount` in `pathname`, still percent-encoded (re-encoding would escape legal
 * characters the vendor never sent). Found anywhere, so a basePath before the mount is kept; null
 * when `pathname` does not pass through the mount.
 */
export const pathBelowMount = (pathname: string, mount: string): string | null => {
	const at = `${pathname}/`.indexOf(`${mount}/`)
	return at === -1 ? null : pathname.slice(at + mount.length) || '/'
}

/** One request to relay, as either relay reads it. */
export interface RelayRequest {
	/** Upper case. */
	method: string
	headers: Headers
	/** Below the relay's mount, still percent-encoded: the route templates decode it per segment. */
	path: string
	/** With or without its leading `?`; empty for none. */
	search: string
	body: CappedBodySource
}

export interface RelayOptions {
	descriptor: ProxyDescriptor
	timeoutMs: number
	maxBodyBytes: number
	trust: ClientIpOptions
	/** Told why an upstream failed, which the answer never says. */
	warn: (message: string) => void
}

/**
 * Relays one request to the vendor URL its path compiles to under the descriptor's routes. Cookies
 * and credentials never go upstream, and `set-cookie` never comes back.
 */
export const relayToVendor = async (
	request: RelayRequest,
	options: RelayOptions
): Promise<Response> => {
	const { descriptor } = options
	const matched = matchProxyRoute(descriptor.routes, request.path, {
		trailingSlashes: descriptor.trailingSlashes,
	})
	if (!matched) {
		return emptyResponse(404)
	}
	if (request.method === 'POST' && matched.kind === 'script') {
		return emptyResponse(405, { allow: SCRIPT_METHODS })
	}
	const { upstreamUrl } = matched
	if (request.search && request.search !== '?') {
		const incoming = request.search.startsWith('?') ? request.search.slice(1) : request.search
		upstreamUrl.search = upstreamUrl.search ? `${upstreamUrl.search}&${incoming}` : `?${incoming}`
	}
	// Buffered rather than streamed: a duplex request stream fails as a hung upstream
	// connection, and the cap has to be enforced before any of it is forwarded anyway.
	let body: ArrayBuffer | undefined
	if (request.method === 'POST') {
		const read = await readCappedBody(request.body, options.maxBodyBytes)
		if (!read.ok) {
			return emptyResponse(read.reason === 'too-large' ? 413 : 400)
		}
		body = read.body
	}
	// The deadline covers time-to-headers only. AbortSignal.timeout would keep running
	// against the body stream and truncate a slow but healthy download.
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), options.timeoutMs)
	const send: FetchLike = descriptor.fetch ?? fetch
	try {
		const upstream = await send(upstreamUrl, {
			method: request.method,
			headers: buildUpstreamHeaders(
				request.headers,
				clientIpFromHeaders(request.headers, options.trust),
				descriptor.forwardHeaders ?? []
			),
			body,
			redirect: 'manual',
			signal: controller.signal,
		})
		return new Response(upstream.body, {
			status: upstream.status,
			headers: buildDownstreamHeaders(upstream.headers, matched.kind),
		})
	} catch (err) {
		options.warn(String(err))
		return emptyResponse(502)
	} finally {
		clearTimeout(timer)
	}
}
