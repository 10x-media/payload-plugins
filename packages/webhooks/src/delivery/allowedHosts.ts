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
 * With no list configured the allowlist lets every host through. A configured list is an
 * allowlist of hostnames, matched exactly or, for a `*.example.com` entry, as any subdomain of it
 * (not `example.com` itself). The port is not part of the match, and an empty list allows nothing.
 *
 * It judges names only. Which addresses a name may resolve to is the URL policy's question
 * (`destination.ts`), answered where the socket opens, and the two are independent: a listed host
 * still has to be public unless the install allows private addresses.
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
