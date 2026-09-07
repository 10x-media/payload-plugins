import type { Endpoint, PayloadHandler, PayloadRequest } from 'payload'
import { clientIpFromHeaders } from '../native/ingest/clientIp'
import { PROXY_PATH } from '../plugin/paths'
import { type AnalyticsRuntime, getRuntime } from '../plugin/runtime'
import { buildDownstreamHeaders, buildUpstreamHeaders, matchProxyRoute } from './proxyRoutes'
import { readCappedBody } from './requestBody'
import { type CaptureSlot, isCaptureSlot, resolveSlotAdapter } from './slots'

export { PROXY_PATH }

/** Deadline for the upstream response headers, not for the body download. */
export const DEFAULT_PROXY_TIMEOUT_MS = 10_000

/** PostHog batches carrying session-replay data routinely exceed 64 KB. */
export const DEFAULT_PROXY_MAX_BODY_BYTES = 1024 * 1024

/** The path pattern the proxy is registered at, one entry per method. */
export const PROXY_ENDPOINT_PATH = `${PROXY_PATH}/:slot/:path*`

/**
 * Payload matches an endpoint by exact method, and `@payloadcms/next` only routes these
 * six, so the handler is registered for all of them: the three it serves, and the three
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

const ALLOWED_METHODS = 'GET, POST, OPTIONS'
const SERVED_METHODS = new Set(['GET', 'POST', 'OPTIONS'])

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers })

/**
 * The request path relative to the slot mount, still percent-encoded: path-to-regexp
 * decodes it per segment, so re-encoding here would turn legal path characters
 * (`,=+:@`) into escapes the vendor never sent.
 */
const subPath = (req: PayloadRequest, slot: CaptureSlot): string => {
	const pathname = req.pathname ?? (req.url ? new URL(req.url).pathname : '')
	const mount = `${PROXY_PATH}/${slot}`
	const start = pathname.indexOf(mount)
	if (start === -1) {
		return '/'
	}
	return pathname.slice(start + mount.length) || '/'
}

const proxyLimits = (runtime: AnalyticsRuntime) => ({
	timeoutMs: runtime.captureProxy?.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS,
	maxBodyBytes: runtime.captureProxy?.maxBodyBytes ?? DEFAULT_PROXY_MAX_BODY_BYTES,
})

/**
 * Public first-party proxy for a slot's vendor tracker: `${PROXY_PATH}/:slot/:path*`,
 * registered for every method Payload routes.
 *
 * The only URLs it ever fetches are compiled from the slot adapter's own
 * `capture.proxy.routes` templates, so an unfilled slot, an adapter without capture, or
 * a path outside the declared routes is a 404 and nothing leaves the server. Credentials
 * (`cookie`, `authorization`) never go upstream and `set-cookie` never comes back; a
 * body over `capture.proxy.maxBodyBytes` is refused with 413 and one that dies in
 * transit with 400, both before anything is forwarded; upstream failures answer 502
 * without echoing the URL or the error.
 */
export const makeProxyHandler = (): PayloadHandler => async (req) => {
	const method = (req.method ?? 'get').toUpperCase()
	if (!SERVED_METHODS.has(method)) {
		return empty(405, { allow: ALLOWED_METHODS })
	}
	// The tracker is same-origin, so a preflight never reaches a real deployment. Answering
	// locally beats forwarding one and stripping the CORS headers that made it meaningful.
	if (method === 'OPTIONS') {
		return empty(204, { allow: ALLOWED_METHODS })
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
	const matched = matchProxyRoute(descriptor.routes, subPath(req, slot), {
		trailingSlashes: descriptor.trailingSlashes,
	})
	if (!matched) {
		return empty(404)
	}
	const { upstreamUrl } = matched
	const search = req.search ?? (req.url ? new URL(req.url).search : '')
	if (search && search !== '?') {
		const incoming = search.startsWith('?') ? search.slice(1) : search
		upstreamUrl.search = upstreamUrl.search ? `${upstreamUrl.search}&${incoming}` : `?${incoming}`
	}
	const limits = proxyLimits(runtime)
	// Buffered rather than streamed: a duplex request stream fails as a hung upstream
	// connection, and the cap has to be enforced before any of it is forwarded anyway.
	let body: ArrayBuffer | undefined
	if (method === 'POST') {
		const read = await readCappedBody(req, limits.maxBodyBytes)
		if (!read.ok) {
			return empty(read.reason === 'too-large' ? 413 : 400)
		}
		body = read.body
	}
	// The deadline covers time-to-headers only. AbortSignal.timeout would keep running
	// against the body stream and truncate a slow but healthy download.
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), limits.timeoutMs)
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
			signal: controller.signal,
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
	} finally {
		clearTimeout(timer)
	}
}

/** The six endpoint entries the plugin registers, all sharing one handler. */
export const proxyEndpoints = (): Endpoint[] => {
	const handler = makeProxyHandler()
	return PROXY_METHODS.map((method) => ({ method, path: PROXY_ENDPOINT_PATH, handler }))
}
