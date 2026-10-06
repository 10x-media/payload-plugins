import type { DedupeAdapter } from '@10x-media/dedupe/types'

/**
 * A candidate source with no index of its own, switched on with `DEDUPE_ADAPTER=custom`: the
 * newest documents of the collection, up to the limit. Every document of a small collection
 * is compared with every other, which finds what blocking keys miss and costs a query per
 * check. Without `scanBuckets` the scan asks it once per document.
 */
export const recentAdapter: DedupeAdapter = {
	findCandidates: async ({ req, collection, limit }) => {
		const result = await req.payload.find({
			collection: collection as never,
			depth: 0,
			// One more than asked, since the document itself is among the newest.
			limit: limit + 1,
			pagination: false,
			select: { createdAt: true },
			overrideAccess: true,
			req,
			sort: '-createdAt',
		})
		return result.docs.map((doc) => ({ id: String(doc.id) }))
	},
}
