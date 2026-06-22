import type { Payload, Where } from 'payload'
import { getCurrentDate } from 'payload'

import { createJobLeaseStore, type JobId, type JobLeaseStore } from './jobLeaseStore'
import { initialLeaseTtlMs } from './leaseMode'
import type { ResolvedReliabilityOptions } from './options'
import { decideRecovery } from './recoveryDecision'

const JOBS_SLUG = 'payload-jobs'

/** What one sweep pass did. */
export type SweepResult = { scanned: number; requeued: number; deadLettered: number }

export type RunSweepArgs = {
	payload: Payload
	options: ResolvedReliabilityOptions
	/** Reuse a store (tests); built from `payload` otherwise. */
	store?: JobLeaseStore
	/** The instant the pass runs at; defaults to the swappable clock. */
	now?: Date
	/** Max candidates per pass. Default 100. */
	limit?: number
	/** Leadership gate. When false the pass is a no-op. Default true. */
	isLeader?: boolean
}

/** The dead-letter error payload written when a job reaches the recovery cap. */
const deadLetterError = (attempts: number): Record<string, unknown> => ({
	cancelled: false,
	message: `@10x-media/jobs sweeper: dead-lettered after reaching the recovery cap (${attempts} attempts)`,
	recovered: false,
})

// The dev app compiles this file with generated types that do not include the
// reliability fields, so reach `payload.find` through a slug-agnostic signature
// (same pattern as registerReliability's create cast).
type JobsFinder = (args: {
	collection: string
	where?: Where
	limit?: number
	depth?: number
	pagination?: boolean
	sort?: string
}) => Promise<{ docs: Array<{ id: JobId; recoveryAttempts?: number }> }>

/**
 * One sweep pass: find stale `processing: true` orphans and either requeue them
 * (below the recovery cap) or dead-letter them (at the cap), each through a fenced
 * conditional write that re-checks staleness, so a job that renewed between the find
 * and the write is skipped and two overlapping sweepers never both reclaim the same
 * orphan. Gated by leadership: callers pass `isLeader` from the Plan 1 sweeper lease.
 */
export const runSweep = async (args: RunSweepArgs): Promise<SweepResult> => {
	const { isLeader = true, limit = 100, options, payload } = args
	const result: SweepResult = { deadLettered: 0, requeued: 0, scanned: 0 }
	if (!isLeader) {
		return result
	}

	const now = args.now ?? getCurrentDate()
	const store = args.store ?? createJobLeaseStore(payload)
	const fallbackMs = initialLeaseTtlMs(options)
	const cutoff = new Date(now.getTime() - fallbackMs).toISOString()

	const where: Where = {
		and: [
			{ processing: { equals: true } },
			{ completedAt: { exists: false } },
			{ hasError: { not_equals: true } },
			{
				or: [
					{ leaseExpiresAt: { less_than: now.toISOString() } },
					{
						and: [{ leaseExpiresAt: { exists: false } }, { updatedAt: { less_than: cutoff } }],
					},
				],
			},
		],
	}

	const find = payload.find as unknown as JobsFinder
	const { docs } = await find({ collection: JOBS_SLUG, depth: 0, limit, sort: 'updatedAt', where })
	result.scanned = docs.length

	for (const doc of docs) {
		const attempts = typeof doc.recoveryAttempts === 'number' ? doc.recoveryAttempts : 0
		if (decideRecovery(attempts, options.maxRecoveries) === 'requeue') {
			if ((await store.requeue(doc.id, now, fallbackMs)).ok) {
				result.requeued += 1
			}
		} else if (
			(await store.deadLetter({ error: deadLetterError(attempts), fallbackMs, jobId: doc.id, now }))
				.ok
		) {
			result.deadLettered += 1
		}
	}

	return result
}
