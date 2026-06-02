import type { Config } from 'payload'

import type { ResolvedReliabilityOptions } from '../reliability/options'
import {
	type QueueEndpointDeps,
	runControlEndpoint,
	statusEndpoint,
	sweepEndpoint,
} from './endpoints'
import type { ResolvedQueueControlOptions } from './options'

/**
 * Register the queue-control layer: harden the native run endpoint by setting
 * `jobs.access.run` to the configured checker, and add the status, hardened-run, and
 * sweep endpoints to `payload-jobs` through the same `jobsCollectionOverrides` seam the
 * reliability and observability layers use (composing, never clobbering).
 */
export const registerQueueControl = (
	config: Config,
	options: ResolvedQueueControlOptions,
	reliability: ResolvedReliabilityOptions | null
): void => {
	const deps: QueueEndpointDeps = { access: options.access, queues: options.queues, reliability }
	const controlEndpoints = [statusEndpoint(deps), runControlEndpoint(deps), sweepEndpoint(deps)]

	const existingOverride = config.jobs?.jobsCollectionOverrides
	config.jobs = {
		...config.jobs,
		access: { ...config.jobs?.access, run: options.access },
		jobsCollectionOverrides: ({ defaultJobsCollection }) => {
			const base = existingOverride
				? existingOverride({ defaultJobsCollection })
				: defaultJobsCollection
			const baseEndpoints = Array.isArray(base.endpoints) ? base.endpoints : []
			return { ...base, endpoints: [...baseEndpoints, ...controlEndpoints] }
		},
	}
}
