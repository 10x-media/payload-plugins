export interface ClientIpOptions {
	/**
	 * Trusted proxies in front of the app, counted from the right of `x-forwarded-for`: the
	 * address the outermost trusted proxy saw. Unset reads the leftmost entry, which is correct
	 * for honest traffic and is whatever the client wrote for the rest, so an install behind a
	 * proxy it controls should set it. There is no default of 1: an install behind a CDN plus a
	 * proxy would then read the CDN's address for every visitor, collapsing geo and the visitor
	 * hash onto one value, which is worse than a spoofable one.
	 */
	trustedProxyHops?: number
}

/**
 * The originating client IP a proxy chain reported: the first hop of `x-forwarded-for`, else
 * `x-real-ip`. Null when the request carries neither, so callers can omit the value instead of
 * forwarding a fabricated one.
 *
 * With `trustedProxyHops >= 1` the forwarded chain is the only source, counted from the right,
 * and a chain shorter than the count answers null rather than falling back to a header the
 * client could have written.
 */
export const clientIpFromHeaders = (
	headers: Headers,
	opts: ClientIpOptions = {}
): string | null => {
	const chain = (headers.get('x-forwarded-for') ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
	const hops = opts.trustedProxyHops ?? 0
	if (hops >= 1) {
		return chain[chain.length - hops] ?? null
	}
	return chain[0] ?? (headers.get('x-real-ip')?.trim() || null)
}
