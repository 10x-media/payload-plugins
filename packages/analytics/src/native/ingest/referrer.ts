import { MAX_QUERY_HOSTNAME_LENGTH, MAX_REFERRER_LENGTH } from '../../query/limits'

/** A hostname as it is compared: lowercased, without a leading `www.`. */
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '')

/**
 * The referrer as it is stored: everything from the first `#` or `?` onwards removed, then
 * capped. A same-origin navigation puts the previous page's whole URL in `document.referrer`,
 * so the query string routinely carries a reset token, a session id or an email address that
 * has no business in an analytics row. Origin and path are kept verbatim, case included,
 * because they are what makes a referrer readable. The fragment goes first: a `?` after a
 * `#` belongs to the fragment, not to a query.
 *
 * An unparseable referrer is stripped on the same terms rather than trusted, and a value that
 * is not a string at all is dropped: the wire field is public and unvalidated, so a body
 * carrying `"referrer": {}` must cost the event its referrer, not the request its response.
 */
export const storedReferrer = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') {
		return undefined
	}
	const stripped = raw.split('#')[0]?.split('?')[0]
	return stripped ? stripped.slice(0, MAX_REFERRER_LENGTH) : undefined
}

/**
 * The referrer's bare host, which is what the `referrer` dimension buckets and reads by:
 * lowercased, without scheme, port, path, query or a leading `www.`. Nothing is reported for
 * a missing, non-string, hostless or unparseable referrer, so the event contributes no
 * referrer bucket.
 *
 * A self-referral reports nothing either: internal navigation is the bulk of any site's
 * traffic, and counting it would put the site's own domain at the top of its referrers
 * breakdown forever. `selfHostname` is the event's own hostname, compared on the same terms
 * (case-insensitively, `www.` stripped). The `source` dimension reads the same absence as its
 * `direct` channel.
 */
export const referrerHost = (raw: unknown, selfHostname: string): string | undefined => {
	if (typeof raw !== 'string' || !raw) {
		return undefined
	}
	let host: string
	try {
		host = new URL(raw).hostname
	} catch {
		return undefined
	}
	const bare = bareHost(host)
	if (!bare || bare === bareHost(selfHostname)) {
		return undefined
	}
	return bare.slice(0, MAX_QUERY_HOSTNAME_LENGTH)
}
