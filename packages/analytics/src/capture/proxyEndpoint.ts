import type { Endpoint, PayloadHandler, PayloadRequest } from 'payload'
import { clientIpFromHeaders } from '../native/ingest/clientIp'
import { PROXY_PATH } from '../plugin/paths'
import { getRuntime } from '../plugin/runtime'
import { buildDownstreamHeaders, buildUpstreamHeaders, matchProxyRoute } from './proxyRoutes'
import { isCaptureSlot, resolveSlotAdapter } from './slots'

export { PROXY_PATH }

/** The path pattern the proxy is registered at, one entry per method. */
export const PROXY_ENDPOINT_PATH = `${PROXY_PATH}/:slot/:path*`

/**
 * Payload matches an endpoint by exact method, and `@payloadcms/next` only routes these
 * six, so the handler is registered for all of them: the three it proxies, and the three
 * it must answer 405 for rather than leaving to Payload's generic 404.
 */
export const PROXY_METHODS: ReadonlyArray<Endpoint['method']> = [
	'get',
	'post',
	'options',
	'put',
	'patch',
	'delete',
]

const PROXIED_METHODS = new Set(['GET', 'POST', 'OPTIONS'])

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers })

/** The request path relative to the slot mount, re-encoded segment by segment. */
const subPath = (req: PayloadRequest): string => {
	const raw = (req.routeParams as { path?: unknown } | undefined)?.path
	const segments = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
	const joined = `/${segments.map(encodeURIComponent).join('/')}`
	return req.pathname?.endsWith('/') && !joined.endsWith('/') ? `${joined}/` : joined
}

/**
 * Public first-party proxy for a slot's vendor tracker: `ALL ${PROXY_PATH}/:slot/:path*`.
 *
 * The only URLs it ever fetches are compiled from the slot adapter's own
 * `capture.proxy.routes` templates, so an unfilled slot, an adapter without capture, or
 * a path outside the declared routes is a 404 and nothing leaves the server. Credentials
 * (`cookie`, `authorization`) never go upstream and `set-cookie` never comes back;
 * upstream failures answer 502 without echoing the URL or the error.
 */
export const makeProxyHandler = (): PayloadHandler => async (req) => {
	const method = (req.method ?? 'get').toUpperCase()
	if (!PROXIED_METHODS.has(method)) {
		return empty(405, { allow: 'GET, POST, OPTIONS' })
	}
	const runtime = getRuntime(req.payload)
	const slot = (req.routeParams as { slot?: unknown } | undefined)?.slot
	if (!runtime || typeof slot !== 'string' || !isCaptureSlot(slot)) {
		return empty(404)
	}
	const adapter = await resolveSlotAdapter(runtime, req, slot)
	const descriptor = adapter?.capture?.proxy
	if (!descriptor || descriptor.routes.length === 0) {
		return empty(404)
	}
	const matched = matchProxyRoute(descriptor.routes, subPath(req))
	if (!matched) {
		return empty(404)
	}
	const { upstreamUrl } = matched
	const search = req.search ?? (req.url ? new URL(req.url).search : '')
	if (search && search !== '?') {
		const incoming = search.startsWith('?') ? search.slice(1) : search
		upstreamUrl.search = upstreamUrl.search ? `${upstreamUrl.search}&${incoming}` : `?${incoming}`
	}
	// Beacons are small, and buffering avoids a duplex request stream whose failure mode
	// is a hung upstream connection rather than a clean error.
	const body = method === 'POST' ? await req.arrayBuffer?.() : undefined
	try {
		const upstream = await fetch(upstreamUrl, {
			method,
			headers: buildUpstreamHeaders(
				req.headers,
				clientIpFromHeaders(req.headers),
				descriptor.forwardHeaders ?? []
			),
			body,
			redirect: 'manual',
			signal: AbortSignal.timeout(runtime.timeoutMs),
		})
		return new Response(upstream.body, {
			status: upstream.status,
			headers: buildDownstreamHeaders(upstream.headers),
		})
	} catch (err) {
		req.payload?.logger?.warn(
			`analytics: capture proxy upstream failed for "${adapter?.id}": ${String(err)}`
		)
		return empty(502)
	}
}

/** The six endpoint entries the plugin registers, all sharing one handler. */
export const proxyEndpoints = (): Endpoint[] => {
	const handler = makeProxyHandler()
	return PROXY_METHODS.map((method) => ({ method, path: PROXY_ENDPOINT_PATH, handler }))
}
