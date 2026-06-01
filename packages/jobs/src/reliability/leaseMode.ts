import type { ResolvedReliabilityOptions } from './options'

/**
 * Heartbeat mode renews a running job's lease from a side timer. Serverless mode
 * never renews (the function is hard-killed at maxDuration with no SIGTERM), so the
 * stamp encodes the platform limit and the sweeper recovers from it.
 */
export const isHeartbeatMode = (options: ResolvedReliabilityOptions): boolean =>
	options.serverlessMaxDurationMs === null

/**
 * The lease TTL stamped when a worker claims a job, and the grace used to age out a
 * claimed-but-never-stamped (null lease) job by its updatedAt. In serverless mode
 * this is the platform hard-kill duration; otherwise the configured job lease TTL.
 */
export const initialLeaseTtlMs = (options: ResolvedReliabilityOptions): number =>
	options.serverlessMaxDurationMs ?? options.jobLeaseTtlMs
