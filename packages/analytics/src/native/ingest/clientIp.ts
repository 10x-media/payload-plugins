import { PLATFORM_HEADERS, type TrustedPlatform } from '../../net/platform'
import { headerEntries } from './requestHost'

export interface ClientIpOptions {
	/**
	 * Trusted proxies counted from the right of `x-forwarded-for`; unset reads the leftmost entry.
	 * No default of 1: behind a CDN plus a proxy it would collapse every visitor onto the CDN.
	 */
	trustedProxyHops?: number
	/**
	 * The platform whose edge header carries the address instead: `x-real-ip` on Vercel,
	 * `cf-connecting-ip` on Cloudflare. Never set together with `trustedProxyHops`.
	 */
	trustedPlatform?: TrustedPlatform
}

const forwardedChain = (headers: Headers): string[] => headerEntries(headers, 'x-forwarded-for')

/**
 * First hop of `x-forwarded-for`, else `x-real-ip`, else null. With trusted hops or a platform set,
 * only that source counts: a short chain or missing header answers null, never a fallback.
 */
export const clientIpFromHeaders = (
	headers: Headers,
	opts: ClientIpOptions = {}
): string | null => {
	if (opts.trustedPlatform !== undefined) {
		return headers.get(PLATFORM_HEADERS[opts.trustedPlatform].ip)?.trim() || null
	}
	const chain = forwardedChain(headers)
	const hops = opts.trustedProxyHops ?? 0
	if (hops >= 1) {
		return chain[chain.length - hops] ?? null
	}
	return chain[0] ?? (headers.get('x-real-ip')?.trim() || null)
}

/**
 * Whether `headers` came through two or more proxies while the install trusts none of them, so
 * the address read from them is the one the visitor wrote.
 */
export const forwardedUntrusted = (headers: Headers, opts: ClientIpOptions): boolean =>
	opts.trustedPlatform === undefined &&
	(opts.trustedProxyHops ?? 0) === 0 &&
	forwardedChain(headers).length >= 2

/**
 * `headers` as if the request came from `ip`, written where {@link clientIpFromHeaders} reads it.
 * Platform location headers are dropped: they describe the request's own address.
 */
export const overlayClientIp = (headers: Headers, ip: string, opts: ClientIpOptions): Headers => {
	const out = new Headers(headers)
	for (const platform of Object.values(PLATFORM_HEADERS)) {
		out.delete(platform.ip)
		out.delete(platform.country)
		out.delete(platform.region)
		out.delete(platform.city)
	}
	if (opts.trustedPlatform !== undefined) {
		out.set(PLATFORM_HEADERS[opts.trustedPlatform].ip, ip)
	}
	const hops = Math.max(1, opts.trustedProxyHops ?? 0)
	out.set('x-forwarded-for', Array.from({ length: hops }, () => ip).join(', '))
	return out
}
