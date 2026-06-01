import { type Config, type Payload, ValidationError } from 'payload'

import { enforceConcurrencyControl } from './concurrencyContract'
import { reliabilityJobFields } from './fields'
import { registerHeartbeat } from './heartbeat'
import { buildJobsLocksCollection, JOBS_LOCKS_SLUG, LEADER_ROLES } from './locksCollection'
import { resolveNodeId } from './nodeId'
import type { ResolvedReliabilityOptions } from './options'

/** Idempotently ensure one lock row per leadership role. Race-safe via the unique `role`. */
const ensureLockRows = async (payload: Payload): Promise<void> => {
	// The locks collection is registered by this plugin at runtime, so a host app's
	// generated Payload types need not include it; create through a slug-agnostic signature.
	const create = payload.create as unknown as (args: {
		collection: string
		data: Record<string, unknown>
		overrideAccess?: boolean
	}) => Promise<unknown>
	for (const role of LEADER_ROLES) {
		try {
			await create({
				collection: JOBS_LOCKS_SLUG,
				data: { fenceToken: 0, leaseExpiresAt: null, owner: null, role },
				overrideAccess: true,
			})
		} catch (err) {
			// Only a duplicate role (row already seeded by another node/boot) is expected.
			if (!(err instanceof ValidationError)) {
				throw err
			}
		}
	}
}

/**
 * Register the reliability layer on the incoming config: add diagnostic fields to
 * `payload-jobs` through the same `jobsCollectionOverrides` seam the observability
 * layer uses (composing, never clobbering), add the locks collection, and ensure the
 * lock rows at init (preserving any host onInit).
 */
export const registerReliability = (config: Config, options: ResolvedReliabilityOptions): void => {
	enforceConcurrencyControl(config, options)

	const existingOverride = config.jobs?.jobsCollectionOverrides
	config.jobs = {
		...config.jobs,
		jobsCollectionOverrides: ({ defaultJobsCollection }) => {
			const base = existingOverride
				? existingOverride({ defaultJobsCollection })
				: defaultJobsCollection
			return { ...base, fields: [...base.fields, ...reliabilityJobFields()] }
		},
	}

	config.collections = [...(config.collections ?? []), buildJobsLocksCollection()]

	const previousOnInit = config.onInit
	config.onInit = async (payload) => {
		await previousOnInit?.(payload)
		await ensureLockRows(payload)
	}

	registerHeartbeat(config, options, resolveNodeId(options.leaderId))
}
