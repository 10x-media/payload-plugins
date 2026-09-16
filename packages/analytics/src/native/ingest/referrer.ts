/** Longest legal DNS name, and the same cap the event's own hostname carries. */
export const MAX_REFERRER_HOST_LENGTH = 253

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
