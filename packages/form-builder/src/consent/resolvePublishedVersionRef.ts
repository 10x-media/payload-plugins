import type { Payload } from 'payload'

/**
 * Returns the latest published version of a doc, or null when versions/drafts are off or nothing
 * is published. Never throws.
 */
export const resolvePublishedVersionRef = async (
	payload: Payload,
	args: { collection: string; id: string | number }
): Promise<{ versionId: string; updatedAt: string } | null> => {
	try {
		const result = await payload.findVersions({
			collection: args.collection as never,
			where: {
				and: [{ parent: { equals: args.id } }, { 'version._status': { equals: 'published' } }],
			},
			sort: '-updatedAt',
			limit: 1,
			depth: 0,
		})
		const doc = result?.docs?.[0]
		if (!doc) {
			return null
		}
		return { versionId: String(doc.id), updatedAt: String(doc.updatedAt) }
	} catch {
		return null
	}
}
