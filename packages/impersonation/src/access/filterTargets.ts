import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import type { ResolvedOptions } from '../types'

export type TargetFilterMap = Record<string, true | Where>

const isWhere = (value: unknown): value is Where =>
	Boolean(value) && typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Resolve the per-collection list filter for the current viewer. Collections
 * that return `false` (or anything other than `true` / a Where) are omitted.
 */
export const resolveTargetFilters = async ({
	collections,
	options,
	req,
}: {
	collections: CollectionSlug[]
	options: ResolvedOptions
	req: PayloadRequest
}): Promise<TargetFilterMap> => {
	const out: TargetFilterMap = {}
	for (const slug of collections) {
		if (!options.access.filterTargets) {
			out[slug] = true
			continue
		}
		let result: boolean | Where
		try {
			result = await options.access.filterTargets({ req, targetCollection: slug })
		} catch {
			continue
		}
		if (result === true) {
			out[slug] = true
			continue
		}
		if (result === false || !isWhere(result)) {
			continue
		}
		out[slug] = result
	}
	return out
}

export const targetMatchesFilter = async ({
	collection,
	filter,
	req,
	targetId,
}: {
	collection: CollectionSlug
	filter: true | Where
	req: PayloadRequest
	targetId: number | string
}): Promise<boolean> => {
	if (filter === true) {
		return true
	}
	const found = await req.payload.find({
		collection,
		depth: 0,
		limit: 1,
		overrideAccess: true,
		pagination: false,
		req,
		where: { and: [{ id: { equals: targetId } }, filter] },
	})
	return found.docs.length > 0
}
