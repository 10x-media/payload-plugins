import type { Payload, Where } from 'payload'

const JOBS_SLUG = 'payload-jobs'

// The dev app compiles this file with generated types that do not include the
// reliability `claimedBy` field, so reach `payload.count` through a slug-agnostic
// signature (same pattern as the sweeper's `payload.find` cast).
type JobsCounter = (args: { collection: string; where?: Where }) => Promise<{ totalDocs: number }>

/** Count this node's in-flight jobs: `processing: true` AND claimed by `claimedBy`. */
export const countInFlight = async (payload: Payload, claimedBy: string): Promise<number> => {
	const count = payload.count as unknown as JobsCounter
	const res = await count({
		collection: JOBS_SLUG,
		where: { and: [{ processing: { equals: true } }, { claimedBy: { equals: claimedBy } }] },
	})
	return res.totalDocs
}
