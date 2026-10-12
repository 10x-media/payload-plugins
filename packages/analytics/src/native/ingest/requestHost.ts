/** Longest legal DNS name, and the cap every stored hostname carries. */
export const MAX_HOSTNAME_LENGTH = 253

/** Dot-separated labels, which is also every IPv4 literal. */
const DNS_NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/

/** An IPv6 literal as a `Host` header spells it, minus the brackets: hex groups and colons. */
const IPV6 = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/

/**
 * The one hostname shape everywhere in this plugin: a public endpoint accepting several spellings
 * of one name would hand a client an unbounded write of daily totals.
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
 * Hostname as stored and compared: lowercased, without port, brackets or trailing dots. Null for
 * junk, so a caller drops it rather than opening a family of daily totals.
 */
export const normalizeHostname = (value: string | null | undefined): string | null => {
	const raw = value?.trim().toLowerCase()
	if (!raw) {
		return null
	}
	// Every trailing dot rather than one: `example.com.` and `example.com..` name the same
	// host, and each extra spelling left standing would be its own family of daily totals.
	const host = stripPort(raw).replace(/\.+$/, '')
	return isHostname(host) ? host : null
}

interface RequestHostnameOptions {
	/** Trusted proxies in front of the app; `x-forwarded-host` is only read at one or more. */
	trustedProxyHops?: number
}

/** A comma-separated header's entries (`x-forwarded-for`), trimmed, empty ones dropped. */
export const headerEntries = (headers: Headers, name: string): string[] =>
	(headers.get(name) ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)

/**
 * `x-forwarded-host` entry `n` from the right under `n` trusted hops (the left is client-written),
 * else `Host`. Never `Origin`: a scripted client can send any, minting unlimited hostnames.
 */
export const requestHostname = (headers: Headers, opts: RequestHostnameOptions): string | null => {
	const hops = opts.trustedProxyHops ?? 0
	if (hops >= 1) {
		const chain = headerEntries(headers, 'x-forwarded-host')
		const forwarded = normalizeHostname(chain[chain.length - hops])
		if (forwarded) {
			return forwarded
		}
	}
	return normalizeHostname(headers.get('host'))
}
