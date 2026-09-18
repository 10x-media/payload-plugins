/** Longest legal DNS name, and the cap every stored hostname carries. */
export const MAX_HOSTNAME_LENGTH = 253

/** Dot-separated labels, which is also every IPv4 literal. */
const DNS_NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/

/** An IPv6 literal as a `Host` header spells it, minus the brackets: hex groups and colons. */
const IPV6 = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/

/**
 * The one shape a hostname has anywhere in this plugin: config entries, `platformHostnames`,
 * the host a request carried and a resolver's answer are all held to it. A host that can only
 * be spelled one way can only open one rollup bucket family, and nothing prunes those, so a
 * public endpoint that accepted several spellings of one name would hand a client an unbounded
 * write.
 */
export const isHostname = (value: string): boolean =>
	value.length > 0 &&
	value.length <= MAX_HOSTNAME_LENGTH &&
	(DNS_NAME.test(value) || IPV6.test(value))

/** `host[:port]`, or the bracketed IPv6 form a `Host` header uses, which loses its brackets. */
const stripPort = (value: string): string => {
	const bracketed = /^\[([^\]]*)\](?::\d+)?$/.exec(value)
	if (bracketed) {
		return bracketed[1] ?? ''
	}
	const named = /^([^:]*)(?::\d+)?$/.exec(value)
	return named?.[1] ?? value
}

/**
 * A hostname as it is stored and compared: lowercased, without port, brackets or trailing root
 * dots. Null for anything that is not {@link isHostname} afterwards, so a caller drops it
 * rather than opening a rollup bucket family for junk.
 */
export const normalizeHostname = (value: string | null | undefined): string | null => {
	const raw = value?.trim().toLowerCase()
	if (!raw) {
		return null
	}
	// Every trailing dot rather than one: `example.com.` and `example.com..` name the same
	// host, and each extra spelling left standing would be its own bucket family.
	const host = stripPort(raw).replace(/\.+$/, '')
	return isHostname(host) ? host : null
}

export interface RequestHostnameOptions {
	/** Trusted proxies in front of the app; `x-forwarded-host` is only read at one or more. */
	trustedProxyHops?: number
}

/**
 * The host the request itself carries: the `x-forwarded-host` entry `n` from the right where
 * `n` proxy hops are trusted, which is the value the outermost trusted proxy wrote, else the
 * `Host` header. Counting from the left would read the attacker-controlled end, since a proxy
 * that appends rather than replaces keeps whatever the client sent ahead of its own value.
 *
 * `Host` is the fallback whenever the forwarded chain yields nothing usable, whether it is
 * shorter than the trusted count or carries junk: the peer is still the trusted proxy, so
 * `Host` is what that proxy sent.
 *
 * The `Origin` header is deliberately never read: a scripted client can pair a valid `Host`
 * with any `Origin` it likes and mint unlimited hostnames inside one scope, which is the hole
 * request attribution exists to close. A split deployment whose page host differs from its API
 * host validates `Origin` itself, through the `hostname` resolver form.
 */
export const requestHostname = (headers: Headers, opts: RequestHostnameOptions): string | null => {
	const hops = opts.trustedProxyHops ?? 0
	if (hops >= 1) {
		const chain = (headers.get('x-forwarded-host') ?? '')
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
		const forwarded = normalizeHostname(chain[chain.length - hops])
		if (forwarded) {
			return forwarded
		}
	}
	return normalizeHostname(headers.get('host'))
}
