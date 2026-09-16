import { MAX_REFERRER_LENGTH } from '../../query/limits'

/** Longest legal DNS name, and the same cap the event's own hostname carries. */
export const MAX_REFERRER_HOST_LENGTH = 253

/**
 * The referrer as it is stored: everything from the first `#` or `?` onwards removed, then
 * capped. A same-origin navigation puts the previous page's whole URL in `document.referrer`,
 * so the query string routinely carries a reset token, a session id or an email address that
 * has no business in an analytics row. Origin and path are kept verbatim, case included,
 * because they are what makes a referrer readable. The fragment goes first: a `?` after a
 * `#` belongs to the fragment, not to a query.
 *
 * An unparseable referrer is stripped on the same terms rather than trusted; `referrerHost`
 * and `deriveSource` read the raw value and are unaffected either way.
 */
export const storedReferrer = (raw: string | undefined): string | undefined => {
	const stripped = raw?.split('#')[0]?.split('?')[0]
	return stripped ? stripped.slice(0, MAX_REFERRER_LENGTH) : undefined
}

/**
 * The referrer's bare host, which is what the `referrer` dimension buckets and reads by:
 * lowercased, without scheme, port, path, query or a leading `www.`. A missing, hostless or
 * unparseable referrer reports nothing, so the event contributes no referrer bucket. A
 * self-referrer still reports its host; calling internal navigation "direct" is the
 * `source` channel's job, not this one's.
 */
export const referrerHost = (raw: string | undefined): string | undefined => {
	if (!raw) {
		return undefined
	}
	let host: string
	try {
		host = new URL(raw).hostname
	} catch {
		return undefined
	}
	const bare = host.toLowerCase().replace(/^www\./, '')
	return bare ? bare.slice(0, MAX_REFERRER_HOST_LENGTH) : undefined
}
