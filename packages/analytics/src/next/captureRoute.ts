import { normalizeMountPath } from '../capture/mountPath'
import {
	DEFAULT_PROXY_MAX_BODY_BYTES,
	DEFAULT_PROXY_TIMEOUT_MS,
	emptyResponse,
	pathBelowMount,
	relayToVendor,
	unforwardedMethodResponse,
} from '../capture/relay'
import { refusedCrossSite, resolveAllowedOrigins } from '../capture/requestTrust'
import type { AnalyticsAdapter } from '../core/contract'
import type { ClientIpOptions } from '../native/ingest/clientIp'
import { isTrustedPlatform, type TrustedPlatform } from '../net/platform'

export interface CaptureRouteOptions {
	/** Where the route handler is mounted: `'/ph'` for `app/ph/[...path]/route.ts`. */
	path: string
	/** The adapter whose `capture.proxy` routes the handler relays, as `adapters` builds it. */
	adapter: AnalyticsAdapter
	/** The plugin's `trustedProxyHops`: the address forwarded upstream is the one it resolves. */
	trustedProxyHops?: number
	/** The plugin's `trustedPlatform`, in place of `trustedProxyHops`. */
	trustedPlatform?: TrustedPlatform
	/** The plugin's `capture.allowedOrigins`: other sites whose pages may post through the relay. */
	allowedOrigins?: string[]
	/** Deadline for the vendor's response headers. Default 10 seconds. */
	timeoutMs?: number
	/** Largest body relayed. Default 1 MB. */
	maxBodyBytes?: number
}

const positiveNumber = (value: number | undefined, name: string, fallback: number): number => {
	if (value === undefined) {
		return fallback
	}
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`analytics: captureRoute's ${name} must be a positive number`)
	}
	return value
}

const resolveTrust = ({
	trustedProxyHops: hops,
	trustedPlatform,
}: CaptureRouteOptions): ClientIpOptions => {
	if (hops !== undefined && !(Number.isInteger(hops) && hops >= 0)) {
		throw new Error('analytics: captureRoute trustedProxyHops must be a non-negative integer')
	}
	if (trustedPlatform !== undefined && !isTrustedPlatform(trustedPlatform)) {
		throw new Error("analytics: captureRoute trustedPlatform must be 'vercel' or 'cloudflare'")
	}
	if (hops !== undefined && trustedPlatform !== undefined) {
		throw new Error('analytics: captureRoute takes trustedProxyHops or trustedPlatform, not both')
	}
	return {
		...(hops === undefined ? {} : { trustedProxyHops: hops }),
		...(trustedPlatform === undefined ? {} : { trustedPlatform }),
	}
}

/**
 * A Next.js route handler relaying one adapter's vendor tracker at a `capture.paths` mount, exported
 * as GET, POST and OPTIONS. No cookie or credential goes upstream, and no `set-cookie` comes back.
 */
export const captureRoute = (
	options: CaptureRouteOptions
): ((request: Request) => Promise<Response>) => {
	const mount = normalizeMountPath(options.path)
	if (mount === '/') {
		throw new Error('analytics: captureRoute must not be mounted at the site root')
	}
	const descriptor = options.adapter.capture?.proxy
	if (!descriptor || descriptor.routes.length === 0) {
		throw new Error(
			`analytics: captureRoute needs an adapter whose capture declares proxy routes; "${options.adapter.id}" declares none`
		)
	}
	const trust = resolveTrust(options)
	const allowed = resolveAllowedOrigins(options.allowedOrigins)
	const limits = {
		timeoutMs: positiveNumber(options.timeoutMs, 'timeoutMs', DEFAULT_PROXY_TIMEOUT_MS),
		maxBodyBytes: positiveNumber(
			options.maxBodyBytes,
			'maxBodyBytes',
			DEFAULT_PROXY_MAX_BODY_BYTES
		),
	}
	return async (request) => {
		const method = request.method.toUpperCase()
		const unforwarded = unforwardedMethodResponse(method)
		if (unforwarded) {
			return unforwarded
		}
		if (method === 'POST' && refusedCrossSite(request.headers, allowed)) {
			return emptyResponse(403)
		}
		const url = new URL(request.url)
		const path = pathBelowMount(url.pathname, mount)
		if (path === null) {
			return emptyResponse(404)
		}
		try {
			return await relayToVendor(
				{ method, headers: request.headers, path, search: url.search, body: request },
				{
					descriptor,
					...limits,
					trust,
					warn: (message) => {
						console.warn(
							`analytics: captureRoute upstream failed for "${options.adapter.id}": ${message}`
						)
					},
				}
			)
		} catch (err) {
			console.warn(`analytics: captureRoute request failed: ${String(err)}`)
			return emptyResponse(500)
		}
	}
}
