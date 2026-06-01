import type { Payload } from 'payload'

import { createMongoLeaseStore } from './leaseStore.mongo'
import { createPostgresLeaseStore } from './leaseStore.postgres'
import type { LeaderRole } from './locksCollection'

/** The current state of one leadership lease row. */
export type LeaseRecord = {
	role: LeaderRole
	owner: string | null
	leaseExpiresAt: Date | null
	fenceToken: number
}

/** The outcome of an acquire/renew attempt. */
export type LeaseResult = {
	/** Whether this caller now holds (or still holds) the lease. */
	ok: boolean
	/** The fence token after the attempt (monotonic; only meaningful when ok). */
	fenceToken: number
}

/**
 * A distributed lease over the `payload-jobs-locks` rows. Every method is a single
 * atomic conditional write at the database, so two contenders never both win.
 * Implemented per adapter because Payload's `db.updateOne` drops the `where`
 * predicate when an `id` is given (validated), so it cannot express a compare-and-set.
 */
export interface LeaseStore {
	/** Acquire `role` if free or expired at `now`. Bumps the fence token on success. */
	acquireOrSteal: (
		role: LeaderRole,
		owner: string,
		ttlMs: number,
		now: Date
	) => Promise<LeaseResult>
	/** Renew `role` if `owner` still holds it at `now`. Does not bump the fence token. */
	renew: (role: LeaderRole, owner: string, ttlMs: number, now: Date) => Promise<LeaseResult>
	/** Release `role` if `owner` holds it (graceful handoff: clears owner and expiry). */
	release: (role: LeaderRole, owner: string) => Promise<void>
	/** Read the current lease row (diagnostics and tests). */
	read: (role: LeaderRole) => Promise<LeaseRecord | null>
}

/** Build the lease store for the running adapter. Throws for an unsupported adapter. */
export const createLeaseStore = (payload: Payload): LeaseStore => {
	if (payload.db.name === 'mongoose') {
		return createMongoLeaseStore(payload)
	}
	if (payload.db.name === 'postgres') {
		return createPostgresLeaseStore(payload)
	}
	throw new Error(`@10x-media/jobs reliability does not support db adapter "${payload.db.name}"`)
}
