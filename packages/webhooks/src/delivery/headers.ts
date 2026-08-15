/**
 * Headers the delivery pipeline owns. A subscription's custom headers are spread over the
 * generated ones, so without this guard a header named `webhook-signature` would replace the
 * real signature and every receiver would reject the delivery, or worse, verify against an
 * attacker-chosen value. HTTP header names are case-insensitive, so matching is too.
 */
const RESERVED = new Set([
	'webhook-id',
	'webhook-timestamp',
	'webhook-signature',
	'x-webhook-event',
])

/** The reserved names in their canonical spelling, for error messages. */
export const RESERVED_HEADER_NAMES = [...RESERVED] as const

export const isReservedHeader = (name: string): boolean => RESERVED.has(name.trim().toLowerCase())

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
