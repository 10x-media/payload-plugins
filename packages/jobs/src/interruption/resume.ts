import type { Payload, Where } from 'payload'

const JOBS_SLUG = 'payload-jobs'

/**
 * Release every job deferred by `by` now instead of at its `waitUntil`. Only
 * jobs still waiting are touched: not running, not completed, not failed.
 * Resuming early is safe: if the pause still holds, the job is not claimed, or
 * is interrupted and deferred again.
 */
export const resumeDeferred = async (
	payload: Payload,
	by: string
): Promise<{ resumed: number }> => {
	if (!payload.collections[JOBS_SLUG]) {
		return { resumed: 0 }
	}
	const where: Where = {
		and: [
			{ deferredBy: { equals: by } },
			{ processing: { equals: false } },
			{ completedAt: { exists: false } },
			{ hasError: { not_equals: true } },
		],
	}
	const { totalDocs } = await payload.db.count({ collection: JOBS_SLUG, where })
	if (totalDocs === 0) {
		return { resumed: 0 }
	}
	await payload.db.updateMany({
		collection: JOBS_SLUG,
		data: { deferredBy: null, waitUntil: null },
		returning: false,
		where,
	})
	return { resumed: totalDocs }
}
