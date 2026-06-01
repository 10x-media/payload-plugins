import type { Payload } from 'payload'

import { leaseExpiry } from './leaseLogic'
import type { LeaseRecord, LeaseResult, LeaseStore } from './leaseStore'
import { JOBS_LOCKS_SLUG } from './locksCollection'

type MongoDoc = LeaseRecord

type MongoModel = {
	findOne: (filter: Record<string, unknown>) => { lean: () => Promise<MongoDoc | null> }
	findOneAndUpdate: (
		filter: Record<string, unknown>,
		update: Record<string, unknown>,
		options?: Record<string, unknown>
	) => Promise<MongoDoc | null>
}

/** Reach the raw Mongoose model the adapter exposes on `db.collections[slug]`. */
const model = (payload: Payload): MongoModel => {
	const collections = (payload.db as unknown as { collections: Record<string, MongoModel> })
		.collections
	const found = collections[JOBS_LOCKS_SLUG]
	if (!found) {
		throw new Error(`@10x-media/jobs: missing Mongoose model for "${JOBS_LOCKS_SLUG}"`)
	}
	return found
}

/** Single-document `findOneAndUpdate` is an atomic compare-and-set on MongoDB. */
export const createMongoLeaseStore = (payload: Payload): LeaseStore => {
	const m = model(payload)

	const toRecord = (doc: MongoDoc | null): LeaseRecord | null =>
		doc === null
			? null
			: {
					fenceToken: doc.fenceToken,
					leaseExpiresAt: doc.leaseExpiresAt ? new Date(doc.leaseExpiresAt) : null,
					owner: doc.owner ?? null,
					role: doc.role,
				}

	return {
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		acquireOrSteal: async (role, owner, ttlMs, now): Promise<LeaseResult> => {
			const doc = await m.findOneAndUpdate(
				{
					$or: [{ owner: null }, { leaseExpiresAt: { $lt: now } }],
					role,
				},
				{
					$inc: { fenceToken: 1 },
					$set: { leaseExpiresAt: leaseExpiry(now, ttlMs), owner },
				},
				{ new: true }
			)
			return { fenceToken: doc?.fenceToken ?? 0, ok: doc !== null }
		},
		read: async (role): Promise<LeaseRecord | null> => toRecord(await m.findOne({ role }).lean()),
		release: async (role, owner): Promise<void> => {
			await m.findOneAndUpdate({ owner, role }, { $set: { leaseExpiresAt: null, owner: null } })
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		renew: async (role, owner, ttlMs, now): Promise<LeaseResult> => {
			const doc = await m.findOneAndUpdate(
				{ owner, role },
				{ $set: { leaseExpiresAt: leaseExpiry(now, ttlMs) } },
				{ new: true }
			)
			return { fenceToken: doc?.fenceToken ?? 0, ok: doc !== null }
		},
	}
}
