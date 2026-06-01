import type { Payload } from 'payload'

import { createMongoJobLeaseStore } from './jobLeaseStore.mongo'
import { createPostgresJobLeaseStore } from './jobLeaseStore.postgres'

/** A Payload job id: a string on Mongo (ObjectId), a number on Postgres (serial). */
export type JobId = number | string

/** The result of a stamp (returns the new claim-generation fence token). */
export type StampResult = { ok: boolean; fenceToken: number }

/** The result of a renew/requeue/dead-letter attempt. */
export type JobLeaseResult = { ok: boolean }

/** The lease-relevant columns of one `payload-jobs` row (diagnostics and tests). */
export type JobLeaseRow = {
	processing: boolean
	leaseExpiresAt: Date | null
	claimedBy: string | null
	fenceToken: number
	recoveryAttempts: number
	updatedAt: Date
}

/** Arguments for dead-lettering, grouped to stay within the 3-parameter lint cap. */
export type DeadLetterArgs = {
	jobId: JobId
	now: Date
	fallbackMs: number
	error: Record<string, unknown>
}

/**
 * A fenced lease over a single `payload-jobs` row. Every write is one atomic
 * conditional update at the database (Mongo single-document `findOneAndUpdate`, or
 * Postgres `UPDATE ... WHERE <guard> RETURNING`), so two contenders never both win.
 * Sibling to the Plan 1 locks `LeaseStore`; implemented per adapter because Payload's
 * `db.updateOne` drops the `where` predicate when an `id` is given.
 */
export interface JobLeaseStore {
	/** Stamp a freshly-claimed job (guarded on `processing = true`); bumps the fence token. */
	stampClaim: (jobId: JobId, owner: string, ttlMs: number, now: Date) => Promise<StampResult>
	/** Extend the lease iff this owner's fence token still matches. */
	renew: (jobId: JobId, fenceToken: number, ttlMs: number, now: Date) => Promise<JobLeaseResult>
	/** Requeue a stale orphan (guarded on `processing = true` AND stale); increments recoveryAttempts. */
	requeue: (jobId: JobId, now: Date, fallbackMs: number) => Promise<JobLeaseResult>
	/** Dead-letter a stale orphan at the recovery cap (same guard). */
	deadLetter: (args: DeadLetterArgs) => Promise<JobLeaseResult>
	/**
	 * Requeue every in-flight job currently claimed by `owner`, in one bulk write, for
	 * graceful drain. Sets `processing: false`, clears the lease, increments
	 * recoveryAttempts, and bumps the fence token so a revived worker's renew fails.
	 * Returns how many rows were released. Unlike `requeue`, it does not require the
	 * lease to be stale (the node owns these claims and is shutting down).
	 */
	releaseAllClaims: (owner: string) => Promise<{ released: number }>
	/** Read the lease columns of a job row. */
	read: (jobId: JobId) => Promise<JobLeaseRow | null>
}

/** Build the job-lease store for the running adapter. Throws for an unsupported adapter. */
export const createJobLeaseStore = (payload: Payload): JobLeaseStore => {
	if (payload.db.name === 'mongoose') {
		return createMongoJobLeaseStore(payload)
	}
	if (payload.db.name === 'postgres') {
		return createPostgresJobLeaseStore(payload)
	}
	throw new Error(`@10x-media/jobs reliability does not support db adapter "${payload.db.name}"`)
}
