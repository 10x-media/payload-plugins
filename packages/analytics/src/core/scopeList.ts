import type { Payload } from 'payload'
import type { ScopeListResolver } from './options'

/**
 * The scopes the sync task fans out over: null first, then each tenant from `scope.list`,
 * deduplicated. A failing resolver degrades to the null-only pass rather than blocking the run.
 */
export const resolveScopeList = async (
	list: ScopeListResolver | undefined,
	payload: Payload
): Promise<Array<string | null>> => {
	if (!list) {
		return [null]
	}
	let raw: string[]
	try {
		const result = await list({ payload })
		if (!Array.isArray(result)) {
			throw new Error('scope.list must resolve to an array of scope ids')
		}
		raw = result
	} catch (err) {
		payload.logger.warn(
			`analytics: scope.list failed, falling back to the install-wide scope: ${String(err)}`
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
