import type { DedupeQueueSlotProps, DedupeQueueSlotServerProps } from '@10x-media/dedupe/types'

/**
 * Dev stand only: the queue page's `beforeList` slot. How many pairs are open and how many were
 * marked not duplicates, for the collection the queue is filtered to, read as the reviewer.
 */
export const QueueSummary = async ({
	collection,
	req,
}: DedupeQueueSlotProps & DedupeQueueSlotServerProps) => {
	const count = async (status: 'dismissed' | 'open') => {
		const { totalDocs } = await req.payload.count({
			collection: 'dedupe-pairs',
			overrideAccess: false,
			req,
			where: {
				status: { equals: status },
				...(collection ? { target: { equals: collection } } : {}),
			},
		})
		return totalDocs
	}
	const [open, dismissed] = await Promise.all([count('open'), count('dismissed')])
	return (
		<p className="queue-summary">
			{open} open pairs · {dismissed} marked not duplicates
		</p>
	)
}
