import type { Payload } from 'payload'
import type {
	DeadLetterArgs,
	JobLeaseResult,
	JobLeaseRow,
	JobLeaseStore,
	StampResult,
} from './jobLeaseStore'
import { leaseExpiry } from './leaseLogic'

const JOBS_SLUG = 'payload-jobs'

type MongoDoc = {
	processing?: boolean
	leaseExpiresAt?: Date | string | null
	claimedBy?: string | null
	fenceToken?: number
	recoveryAttempts?: number
	updatedAt?: Date | string
}

type MongoModel = {
	findOne: (filter: Record<string, unknown>) => { lean: () => Promise<MongoDoc | null> }
	findOneAndUpdate: (
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: Record<string, unknown>
	) => Promise<MongoDoc | null>
	updateMany: (
		filter: Record<string, unknown>,
		update: Record<string, unknown>
	) => Promise<{ modifiedCount?: number }>
}

/** Reach the raw Mongoose model the adapter exposes on `db.collections[slug]`. */
const model = (payload: Payload): MongoModel => {
	const collections = (payload.db as unknown as { collections: Record<string, MongoModel> })
		.collections
	const found = collections[JOBS_SLUG]
	if (!found) {
		throw new Error(`@10x-media/jobs: missing Mongoose model for "${JOBS_SLUG}"`)
	}
	return found
}

/** The stale-orphan predicate shared by requeue and dead-letter. */
const stale = (now: Date, fallbackMs: number): Record<string, unknown> => ({
	hasError: { $ne: true },
	processing: true,
	$or: [
		{ leaseExpiresAt: { $lt: now } },
		{ leaseExpiresAt: null, updatedAt: { $lt: new Date(now.getTime() - fallbackMs) } },
	],
})

/** Single-document `findOneAndUpdate` is an atomic compare-and-set on MongoDB. */
export const createMongoJobLeaseStore = (payload: Payload): JobLeaseStore => {
	const m = model(payload)

	return {
		deadLetter: async ({
			error,
			fallbackMs,
			jobId,
			now,
		}: DeadLetterArgs): Promise<JobLeaseResult> => {
			const doc = await m.findOneAndUpdate(
				{ _id: jobId, ...stale(now, fallbackMs) },
				{
					$inc: { fenceToken: 1 },
					$set: { claimedBy: null, error, hasError: true, leaseExpiresAt: null, processing: false },
				},
				{ new: true }
			)
			return { ok: doc !== null }
		},
		read: async (jobId): Promise<JobLeaseRow | null> => {
			const doc = await m.findOne({ _id: jobId }).lean()
			if (doc === null) {
				return null
			}
			return {
				claimedBy: doc.claimedBy ?? null,
				fenceToken: doc.fenceToken ?? 0,
				leaseExpiresAt: doc.leaseExpiresAt ? new Date(doc.leaseExpiresAt) : null,
				processing: doc.processing === true,
				recoveryAttempts: doc.recoveryAttempts ?? 0,
				updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(0),
			}
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (jobId, fenceToken, ttlMs, now)
		renew: async (jobId, fenceToken, ttlMs, now): Promise<JobLeaseResult> => {
			const doc = await m.findOneAndUpdate(
				{ _id: jobId, fenceToken },
				{ $set: { leaseExpiresAt: leaseExpiry(now, ttlMs) } },
				{ new: true }
			)
			return { ok: doc !== null }
		},
		releaseAllClaims: async (owner): Promise<{ released: number }> => {
			const res = await m.updateMany(
				{ claimedBy: owner, processing: true },
				{
					$inc: { fenceToken: 1, recoveryAttempts: 1 },
					$set: { claimedBy: null, leaseExpiresAt: null, processing: false, waitUntil: null },
				}
			)
			return { released: res.modifiedCount ?? 0 }
		},
		requeue: async (jobId, now, fallbackMs): Promise<JobLeaseResult> => {
			const doc = await m.findOneAndUpdate(
				{ _id: jobId, ...stale(now, fallbackMs) },
				{
					$inc: { fenceToken: 1, recoveryAttempts: 1 },
					$set: { claimedBy: null, leaseExpiresAt: null, processing: false, waitUntil: null },
				},
				{ new: true }
			)
			return { ok: doc !== null }
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (jobId, owner, ttlMs, now)
		stampClaim: async (jobId, owner, ttlMs, now): Promise<StampResult> => {
			const doc = await m.findOneAndUpdate(
				{ _id: jobId, processing: true },
				{
					$inc: { fenceToken: 1 },
					$set: { claimedBy: owner, leaseExpiresAt: leaseExpiry(now, ttlMs), startedAt: now },
				},
				{ new: true }
			)
			return { fenceToken: doc?.fenceToken ?? 0, ok: doc !== null }
		},
	}
}
