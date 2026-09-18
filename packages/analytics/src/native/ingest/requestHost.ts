/** Longest legal DNS name, and the cap every stored hostname carries. */
export const MAX_HOSTNAME_LENGTH = 253

/** Whitespace, a slash or an at sign: none of them can appear in a host, so the value is junk. */
const ILLEGAL = /[\s/@]/

/** A bracketed IPv6 literal keeps its brackets, which is how a Host header spells one. */
const stripPort = (value: string): string => {
	if (value.startsWith('[')) {
		const end = value.indexOf(']')
		return end === -1 ? value : value.slice(0, end + 1)
	}
	const colon = value.indexOf(':')
	return colon === -1 ? value : value.slice(0, colon)
}

/**
 * A hostname as it is stored and compared: lowercased, without port or trailing root dot, and
 * capped. Null for anything that cannot be one, so a caller drops it rather than opening a
 * rollup bucket family for junk.
 */
export const normalizeHostname = (value: string | null | undefined): string | null => {
	const raw = value?.trim()
	if (!raw) {
		return null
	}
	const host = stripPort(raw.toLowerCase()).replace(/\.$/, '')
	if (!host || ILLEGAL.test(host)) {
		return null
	}
	return host.slice(0, MAX_HOSTNAME_LENGTH)
}

export interface RequestHostnameOptions {
	/** Trusted proxies in front of the app; `x-forwarded-host` is only read at one or more. */
	trustedProxyHops?: number
}

/**
 * The host the request itself carries: `x-forwarded-host`'s first value where a proxy hop is
 * trusted, else `Host`. Null when neither yields a usable hostname.
 *
 * The `Origin` header is deliberately never read: a scripted client can pair a valid `Host`
 * with any `Origin` it likes and mint unlimited hostnames inside one scope, which is the hole
 * request attribution exists to close. A split deployment whose page host differs from its API
 * host validates `Origin` itself, through the `hostname` resolver form.
 */
export const requestHostname = (headers: Headers, opts: RequestHostnameOptions): string | null => {
	const forwarded =
		(opts.trustedProxyHops ?? 0) >= 1 ? headers.get('x-forwarded-host')?.split(',')[0] : undefined
	return normalizeHostname(forwarded?.trim() || headers.get('host'))
}
