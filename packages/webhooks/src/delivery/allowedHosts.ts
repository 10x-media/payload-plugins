/**
 * Refuse an allowlist entry that could never match a hostname. Every such mistake fails closed,
 * which is the safe direction and also the confusing one: a list of `https://hooks.example.com`
 * rejects every subscription, hooks.example.com included, with nothing to say why.
 */
export const assertAllowedHosts = (allowedHosts: string[] | undefined): void => {
	for (const entry of allowedHosts ?? []) {
		const pattern = entry.trim().toLowerCase()
		const host = pattern.startsWith('*.') ? pattern.slice(2) : pattern
		// A bare hostname is exactly what the URL parser gives back for it, unchanged. A scheme, a
		// port, a path or an unbracketed IPv6 address all come back different. A wildcard anywhere
		// but the leading label parses as an ordinary character, so it is refused by name.
		const parsed = URL.canParse(`http://${host}`) ? new URL(`http://${host}`) : null
		if (
			host === '' ||
			host.includes('*') ||
			parsed?.hostname !== host ||
			parsed.host !== host ||
			parsed.pathname !== '/'
		) {
			throw new Error(
				`@10x-media/webhooks: delivery.allowedHosts entry '${entry}' is not a hostname. Use a bare host such as 'hooks.example.com', or '*.example.com' for its subdomains, with no scheme, port or path.`
			)
		}
	}
}

/**
 * Whether a subscription URL's host is one the install allows deliveries to.
 *
 * With no list configured every host is allowed, which is the default: localhost and private
 * addresses are what development and internal receivers look like. A configured list is an
 * allowlist of hostnames, matched exactly or, for a `*.example.com` entry, as any subdomain of it
 * (not `example.com` itself). The port is not part of the match, and an empty list allows nothing.
 *
 * It is a host allowlist rather than a block on private addresses on purpose. A name on the list
 * is one the operator chose, whereas a blocklist would have to resolve DNS and pin the result to
 * mean anything, since a public name can point at an internal address. Deliveries do not follow
 * redirects, so an allowed host cannot hand the request on to one that is not.
 */
export const isAllowedHost = (url: string, allowedHosts: string[] | undefined): boolean => {
	if (!allowedHosts) {
		return true
	}
	if (!URL.canParse(url)) {
		return false
	}
	const host = new URL(url).hostname.toLowerCase()
	return allowedHosts.some((entry) => {
		const pattern = entry.trim().toLowerCase()
		return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern
	})
}
