import type { Payload } from 'payload'
import type { ScopesResolver } from './options'

/**
 * Resolves the scopes a cron tier (warm, sync) fans out over: the install-wide
 * null scope first, then each tenant scope from `scopes()`, deduplicated (an
 * empty string folds into null). A throwing or rejecting resolver degrades to
 * the null-only pass so one tenant-enumeration bug does not block the whole run.
 */
export const resolveScopeList = async (
	scopes: ScopesResolver | undefined,
	payload: Payload
): Promise<Array<string | null>> => {
	if (!scopes) {
		return [null]
	}
	let raw: string[]
	try {
		raw = await scopes({ payload })
	} catch (err) {
		payload.logger.warn(
			`analytics: scopes() failed, falling back to the install-wide scope: ${String(err)}`
		)
		return [null]
	}
	const out: Array<string | null> = [null]
	const seen = new Set<string | null>([null])
	for (const value of raw) {
		const scope = value === '' ? null : value
		if (seen.has(scope)) {
			continue
		}
		seen.add(scope)
		out.push(scope)
	}
	return out
}
