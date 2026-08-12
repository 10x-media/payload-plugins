import type { Payload } from 'payload'

/**
 * Extra fields to write onto a seeded guide: the ones a project added to the
 * wiki pages collection through `overrides`, which the seed itself knows
 * nothing about.
 *
 * The function form is handed the running `payload`, which is what a value that
 * has to be looked up needs: a category's id, the tenant a guide belongs to, an
 * author resolved by email. It may be async.
 */
export type WikiSeedAdditionalData =
	| ((payload: Payload) => Promise<Record<string, unknown>> | Record<string, unknown>)
	| Record<string, unknown>

/**
 * The fields `seedWiki` writes itself.
 *
 * Extra data is *additional*, so reaching one of these is an error rather than
 * a last-writer-wins merge. `slug` is the reason it has to be loud: it is the
 * identity the next run matches on, so a definition that overwrote it would
 * create a second guide instead of updating this one, and the run that did it
 * would still report success.
 */
const RESERVED = new Set([
	'_status',
	'content',
	'featured',
	'featuredOrder',
	'slug',
	'summary',
	'targetBlocks',
	'targetCollections',
	'targetFields',
	'targetGlobals',
	'title',
])

/**
 * Resolve a guide's extra seed data to a plain object, rejecting anything that
 * would collide with the seed's own fields. `label` names the offending guide
 * in the message, matching the rest of the seed's failures.
 */
export const resolveAdditionalData = async (
	additional: undefined | WikiSeedAdditionalData,
	payload: Payload,
	label: string
): Promise<Record<string, unknown>> => {
	if (additional === undefined) {
		return {}
	}
	const data = typeof additional === 'function' ? await additional(payload) : additional
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		throw new Error(`@10x-media/admin-wiki seed: "${label}" did not resolve to an object`)
	}
	const reserved = Object.keys(data).filter((key) => RESERVED.has(key))
	if (reserved.length > 0) {
		throw new Error(
			`@10x-media/admin-wiki seed: "${label}" writes fields the seed owns: ${reserved.join(', ')}`
		)
	}
	return data
}
