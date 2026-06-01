import type { CollectionConfig } from 'payload'

/** Slug of the plugin-owned leases collection. Table name: payload_jobs_locks. */
export const JOBS_LOCKS_SLUG = 'payload-jobs-locks'

/** The two singleton leadership roles. */
export const LEADER_ROLES = ['scheduler', 'sweeper'] as const
export type LeaderRole = (typeof LEADER_ROLES)[number]

/**
 * A hidden collection holding one row per leadership role. Acquire/renew/steal are
 * conditional updates against these rows (see the lease store). Not edit-locked,
 * not shown in admin, and access is closed by default (the plugin mutates it
 * directly through the db adapter, never the REST/GraphQL API).
 */
export const buildJobsLocksCollection = (): CollectionConfig => ({
	slug: JOBS_LOCKS_SLUG,
	access: {
		create: () => false,
		delete: () => false,
		read: () => false,
		update: () => false,
	},
	admin: { hidden: true },
	fields: [
		{ name: 'role', type: 'text', index: true, required: true, unique: true },
		{ name: 'owner', type: 'text' },
		{ name: 'leaseExpiresAt', type: 'date' },
		{ name: 'fenceToken', type: 'number', defaultValue: 0, required: true },
	],
	lockDocuments: false,
})
