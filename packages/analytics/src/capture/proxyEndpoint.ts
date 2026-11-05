import type { Endpoint, PayloadHandler, PayloadRequest } from 'payload'
import type { RoutePaths } from '../plugin/routes'
import { type AnalyticsRuntime, getRuntime, resolveCaptureScopeFor } from '../plugin/runtime'
import type { CaptureSlot } from '../tracker/config'
import {
	DEFAULT_PROXY_MAX_BODY_BYTES,
	DEFAULT_PROXY_TIMEOUT_MS,
	emptyResponse,
	pathBelowMount,
	relayToVendor,
	unforwardedMethodResponse,
} from './relay'
import { refusedCrossSite, warnUntrustedForwarding } from './requestTrust'
import { refusedSameSite } from './sameSite'
import { isCaptureSlot, resolveSlotAdapter } from './slots'

export { DEFAULT_PROXY_MAX_BODY_BYTES, DEFAULT_PROXY_TIMEOUT_MS } from './relay'

/**
 * Payload matches endpoints by exact method and `@payloadcms/next` routes only these six: three
 * served, three answered 405 rather than left to Payload's generic 404.
 */
const PROXY_METHODS: ReadonlyArray<Endpoint['method']> = [
	'get',
	'post',
	'options',
	'put',
	'patch',
	'delete',
]

/**
 * Whether a POST comes from a page that may not relay through this slot: another site's, which
 * cannot use this site's vendor accounts, or on the tenant slot a sibling subdomain's posting into
 * another tenant's vendor project.
 */
const refusedPost = async (
	req: PayloadRequest,
	runtime: AnalyticsRuntime,
	slot: CaptureSlot
): Promise<boolean> =>
	refusedCrossSite(req.headers, runtime.allowedOrigins) ||
	(slot === 'tenant' &&
		(await refusedSameSite(
			req,
			() => resolveCaptureScopeFor(runtime, req),
			(twin) => resolveCaptureScopeFor(runtime, twin)
		)))

/**
 * Public first-party proxy for a slot's vendor tracker at `<proxyMount>/:slot/:path*`, relaying only
 * the slot adapter's declared routes; another site's or another tenant's page is refused with 403.
 */
export const makeProxyHandler =
	(proxyMount: string): PayloadHandler =>
	async (req) => {
		try {
			return await relay(req, proxyMount)
		} catch (err) {
			req.payload?.logger?.warn(`analytics: capture proxy request failed: ${String(err)}`)
			return emptyResponse(500)
		}
	}

const relay = async (req: PayloadRequest, proxyMount: string): Promise<Response> => {
	const method = (req.method ?? 'get').toUpperCase()
	const unforwarded = unforwardedMethodResponse(method)
	if (unforwarded) {
		return unforwarded
	}
	const runtime = getRuntime(req.payload)
	const slot = req.routeParams?.slot
	if (!runtime || typeof slot !== 'string' || !isCaptureSlot(slot)) {
		return emptyResponse(404)
	}
	if (method === 'POST' && (await refusedPost(req, runtime, slot))) {
		return emptyResponse(403)
	}
	const adapter = await resolveSlotAdapter(runtime, req, slot)
	const descriptor = adapter?.capture?.proxy
	if (!adapter || !descriptor || descriptor.routes.length === 0) {
		return emptyResponse(404)
	}
	const trust = {
		trustedProxyHops: runtime.trustedProxyHops,
		trustedPlatform: runtime.trustedPlatform,
	}
	warnUntrustedForwarding(req.payload, req.headers, trust)
	const pathname = req.pathname ?? (req.url ? new URL(req.url).pathname : '')
	return relayToVendor(
		{
			method,
			headers: req.headers,
			path: pathBelowMount(pathname, `${proxyMount}/${slot}`) ?? '/',
			search: req.search ?? (req.url ? new URL(req.url).search : ''),
			body: req,
		},
		{
			descriptor,
			timeoutMs: runtime.captureProxy?.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS,
			maxBodyBytes: runtime.captureProxy?.maxBodyBytes ?? DEFAULT_PROXY_MAX_BODY_BYTES,
			trust,
			warn: (message) =>
				req.payload?.logger?.warn(
					`analytics: capture proxy upstream failed for "${adapter.id}": ${message}`
				),
		}
	)
}

/** The six endpoint entries the plugin registers, all sharing one handler. */
export const proxyEndpoints = (routes: Pick<RoutePaths, 'proxy' | 'proxyPattern'>): Endpoint[] => {
	const handler = makeProxyHandler(routes.proxy)
	return PROXY_METHODS.map((method) => ({ method, path: routes.proxyPattern, handler }))
}
