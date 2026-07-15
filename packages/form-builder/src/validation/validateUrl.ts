import type { PayloadRequest } from 'payload'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

/**
 * Payload field validator for URL config fields (signed-webhook `url`, response redirect `url`):
 * unset is fine (the consumer enforces presence where it matters), otherwise the value must parse
 * as an absolute http(s) URL.
 */
export const validateUrl = (
	value: unknown,
	{ req }: { data?: unknown; req: PayloadRequest }
): string | true => {
	if (typeof value !== 'string' || value.length === 0) {
		return true
	}
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		return asTranslate(req.t)(keys.validationUrlInvalid)
	}
	return parsed.protocol === 'http:' || parsed.protocol === 'https:'
		? true
		: asTranslate(req.t)(keys.validationUrlInvalid)
}
