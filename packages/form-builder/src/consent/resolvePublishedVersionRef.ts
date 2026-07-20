import type { Payload, PayloadRequest } from 'payload'

export type ResolvePublishedVersionRefArgs = {
	payload: Payload
	collection: string
	id: number | string
	/** Threaded into `findVersions` so a version written earlier in the same transaction is visible. */
	req?: PayloadRequest
}

/**
 * The id of a document's latest published version, or null when nothing is published.
 *
 * Drafts-only, and deliberately not a versions check: `_status` exists only where
 * `versions.drafts` is on (Payload adds the base version fields inside that branch when
 * sanitizing), so on a collection with plain versions and no drafts this query matches nothing and
 * returns null, which is indistinguishable from having no versions at all. Callers must decide the
 * difference themselves with `hasDraftsEnabled` rather than reading null as "no versions" (see
 * `captureConsent`). Never throws.
 */
export const resolvePublishedVersionRef = async (
	args: ResolvePublishedVersionRefArgs
): Promise<string | null> => {
	try {
		const result = await args.payload.findVersions({
			collection: args.collection as never,
			where: {
				and: [{ parent: { equals: args.id } }, { 'version._status': { equals: 'published' } }],
			},
			sort: '-updatedAt',
			limit: 1,
			depth: 0,
			req: args.req,
		})
		const doc = result?.docs?.[0]
		return doc ? String(doc.id) : null
	} catch {
		return null
	}
}
