import type { Payload } from 'payload'
import { kindOf } from '../core/values'
import { type ClientIpOptions, forwardedUntrusted } from '../native/ingest/clientIp'
import { normalizeOrigin, parseOrigin } from '../net/origin'

/** `capture.allowedOrigins` checked at boot: exact origins, compared as browsers send them. */
export const resolveAllowedOrigins = (value: unknown): ReadonlySet<string> => {
	if (value === undefined) {
		return new Set()
	}
	if (!Array.isArray(value)) {
		throw new Error(
			`analytics: capture.allowedOrigins must be a list of origins such as "https://shop.example.com", got ${kindOf(value)}`
		)
	}
	const origins = new Set<string>()
	for (const entry of value) {
		const parsed = typeof entry === 'string' ? parseOrigin(entry, true) : null
		if (parsed === null || 'problem' in parsed) {
			throw new Error(
				`analytics: capture.allowedOrigins entries must each be one exact origin, a scheme and host with an optional port and no path or wildcard, such as "https://shop.example.com", got ${kindOf(entry)}`
			)
		}
		origins.add(parsed.origin)
	}
	return origins
}

/** The browser's `Sec-Fetch-Site` relation of the requesting page to this site, lowercased. */
export const fetchSiteOf = (headers: Headers): string | undefined =>
	headers.get('sec-fetch-site')?.trim().toLowerCase()

/** The request's `Origin` as a browser writes it; null when absent or not an http(s) origin. */
export const requestOrigin = (headers: Headers): string | null => {
	const origin = headers.get('origin')
	return origin === null ? null : normalizeOrigin(origin)
}

/**
 * Whether a capture POST came from another site's page: `Sec-Fetch-Site: cross-site` with an
 * `Origin` outside `capture.allowedOrigins`. A request without the header passes, as non-browsers do.
 */
export const refusedCrossSite = (
	headers: Headers,
	allowed: ReadonlySet<string> | undefined
): boolean => {
	if (fetchSiteOf(headers) !== 'cross-site') {
		return false
	}
	const origin = requestOrigin(headers)
	return origin === null || !allowed?.has(origin)
}

/** The Payload instances that already said so, so a busy site hears it once. */
const warnedForwarding = new WeakSet<Payload>()

export const UNTRUSTED_FORWARDING_WARNING =
	'analytics: a request came through two or more proxies (its x-forwarded-for header lists several addresses), but neither trustedProxyHops nor trustedPlatform is set, so the plugin used the first address, which the visitor can write. Set trustedProxyHops to the number of proxies in front of the app, or trustedPlatform to "vercel" or "cloudflare". Logged once.'

/** Warns once per instance about the first request whose forwarded chain nothing vouches for. */
export const warnUntrustedForwarding = (
	payload: Payload,
	headers: Headers,
	trust: ClientIpOptions
): void => {
	if (warnedForwarding.has(payload) || !forwardedUntrusted(headers, trust)) {
		return
	}
	warnedForwarding.add(payload)
	payload.logger?.warn(UNTRUSTED_FORWARDING_WARNING)
}
