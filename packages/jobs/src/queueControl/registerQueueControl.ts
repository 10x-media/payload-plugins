import type { Config } from 'payload'

import type { ResolvedReliabilityOptions } from '../reliability/options'
import type { JobAccess } from './access'
import { type QueueEndpointDeps, runControlEndpoint, statusEndpoint } from './endpoints'
import type { ResolvedQueueControlOptions } from './options'

/**
 * Register the queue-control layer: harden the native run endpoint by composing the
 * plugin's access checker with any existing `jobs.access.run` (both must pass), and
 * add the status and hardened-run endpoints to `payload-jobs` through the same
 * `jobsCollectionOverrides` seam the reliability and observability layers use.
 */
export const registerQueueControl = (
	config: Config,
	options: ResolvedQueueControlOptions,
	reliability: ResolvedReliabilityOptions | null
): void => {
	const existingRun = config.jobs?.access?.run
	// Compose the plugin's checker with any pre-existing jobs.access.run so BOTH must pass.
	// Used for the native /run endpoint AND the plugin's own job-executing endpoints below,
	// so a stricter jobs.access.run cannot be bypassed via /queue-run.
	const composedRun: JobAccess = existingRun
		? async (args) => (await existingRun(args)) && (await options.access(args))
		: options.access

	// Status is read-only health, so it keeps the plugin's own access; run executes
	// jobs, so it enforces the composed checker.
	const statusDeps: QueueEndpointDeps = {
		access: options.access,
		queues: options.queues,
		reliability,
	}
	const runDeps: QueueEndpointDeps = { access: composedRun, queues: options.queues, reliability }
	const controlEndpoints = [statusEndpoint(statusDeps), runControlEndpoint(runDeps)]

	const existingOverride = config.jobs?.jobsCollectionOverrides
	config.jobs = {
		...config.jobs,
		access: { ...config.jobs?.access, run: composedRun },
		jobsCollectionOverrides: ({ defaultJobsCollection }) => {
			const base = existingOverride
				? existingOverride({ defaultJobsCollection })
				: defaultJobsCollection
			const baseEndpoints = Array.isArray(base.endpoints) ? base.endpoints : []
			return { ...base, endpoints: [...baseEndpoints, ...controlEndpoints] }
		},
	}
}
