/**
 * Headers the delivery pipeline owns. A subscription's custom headers are spread over the
 * generated ones, so without this guard a header named `webhook-signature` would replace the
 * real signature and every receiver would reject the delivery, or worse, verify against an
 * attacker-chosen value. HTTP header names are case-insensitive, so matching is too.
 *
 * `content-type` and `user-agent` are here for the same reason rather than a weaker one: the body
 * is always `JSON.stringify` output, so a subscription that relabels it `text/plain` mislabels
 * every delivery it sends and gives the receiver nothing to notice that with.
 */
const RESERVED = new Set([
	'content-type',
	'user-agent',
	'webhook-id',
	'webhook-timestamp',
	'webhook-signature',
	'x-webhook-event',
])

/** The reserved names in their canonical spelling, for error messages. */
export const RESERVED_HEADER_NAMES = [...RESERVED] as const

export const isReservedHeader = (name: string): boolean => RESERVED.has(name.trim().toLowerCase())

/**
 * RFC 9110 field-name: one or more `tchar`. A name outside this set is not a header at all, and
 * `fetch` throws on it at delivery time rather than dropping it, so it has to be caught where it
 * is entered.
 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export const isValidHeaderName = (name: string): boolean => HEADER_NAME.test(name.trim())

/** Custom headers minus any that would collide with the plugin's own. */
export const withoutReservedHeaders = (
	headers?: Record<string, string>
): Record<string, string> | undefined => {
	if (!headers) {
		return undefined
	}
	const entries = Object.entries(headers).filter(([key]) => !isReservedHeader(key))
	return entries.length ? Object.fromEntries(entries) : undefined
}
