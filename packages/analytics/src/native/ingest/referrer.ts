import { MAX_QUERY_HOSTNAME_LENGTH, MAX_REFERRER_LENGTH } from '../../query/limits'

/** A host lowercased and without `www.`, the form every referrer comparison uses. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '')

const parsedHost = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string' || !raw) {
		return undefined
	}
	try {
		return bareHost(new URL(raw).hostname) || undefined
	} catch {
		return undefined
	}
}

/**
 * Referrer cut at the first `#` or `?`, then capped: a same-origin referrer's query can carry a
 * reset token or an email address. A non-string is dropped, since the wire field is unvalidated.
 */
export const storedReferrer = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') {
		return undefined
	}
	const stripped = raw.split('#')[0]?.split('?')[0]
	return stripped ? stripped.slice(0, MAX_REFERRER_LENGTH) : undefined
}

/**
 * Whether a referrer is a page of the event's own site: its own hostname, or another one its
 * scope records hits under (`siblings`, bare hosts), compared the way {@link referrerHost} does.
 */
export const isSiteReferral = (
	raw: unknown,
	selfHostname: string,
	siblings?: ReadonlySet<string>
): boolean => {
	const bare = parsedHost(raw)
	return bare !== undefined && (bare === bareHost(selfHostname) || (siblings?.has(bare) ?? false))
}

/**
 * Bare host the `referrer` dimension groups by; undefined when unparseable or for the site itself
 * (`selfHostname` and `siblings`), which `source` then reads as direct.
 */
export const referrerHost = (
	raw: unknown,
	selfHostname: string,
	siblings?: ReadonlySet<string>
): string | undefined => {
	const bare = parsedHost(raw)
	if (!bare || isSiteReferral(raw, selfHostname, siblings)) {
		return undefined
	}
	return bare.slice(0, MAX_QUERY_HOSTNAME_LENGTH)
}

/** A link inside the hit's own site moves a visit along rather than opening one. */
export const isSelfReferral = (raw: unknown, selfHostname: string): boolean => {
	const bare = parsedHost(raw)
	return bare !== undefined && bare === bareHost(selfHostname)
}
