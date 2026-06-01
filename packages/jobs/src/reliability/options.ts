/** Tuning for the jobs reliability layer. All durations are milliseconds. */
export type ReliabilityOptions = {
	/** How long a worker's claim is valid before the sweeper may reclaim it. Default 300000 (5 min). */
	jobLeaseTtlMs?: number
	/** How often a running worker renews its job lease. Default jobLeaseTtlMs / 3. */
	heartbeatIntervalMs?: number
	/** How often the sweeper scans for orphaned jobs. Default 60000. */
	sweepIntervalMs?: number
	/** How many times the sweeper requeues a job before dead-lettering it. Default 3. */
	maxRecoveries?: number
	/** How long a leadership lease (scheduler/sweeper) is valid. Default 30000. */
	leaderLeaseTtlMs?: number
	/** A stable id for this node/process. Defaults to a generated value at runtime. */
	leaderId?: string
	/**
	 * Serverless mode: when set, job staleness derives from this platform hard-kill
	 * duration instead of a heartbeat (heartbeats are meaningless when the function
	 * is killed at maxDuration with no SIGTERM).
	 */
	serverless?: { maxDurationMs: number }
	/**
	 * Recommend (true) Payload's `enableConcurrencyControl` for app-level mutual
	 * exclusion under multi-node. Documentation-facing; consumed in a later plan.
	 */
	requireConcurrencyControl?: boolean
}

/** Reliability options with every value resolved. `null` means reliability is off. */
export type ResolvedReliabilityOptions = {
	jobLeaseTtlMs: number
	heartbeatIntervalMs: number
	sweepIntervalMs: number
	maxRecoveries: number
	leaderLeaseTtlMs: number
	leaderId: string | null
	serverlessMaxDurationMs: number | null
	requireConcurrencyControl: boolean
}

/** Resolve user reliability options to a fully-defaulted object, or `null` when disabled. */
export const resolveReliabilityOptions = (
	options: ReliabilityOptions | false | undefined
): ResolvedReliabilityOptions | null => {
	if (options === undefined || options === false) {
		return null
	}
	const jobLeaseTtlMs = options.jobLeaseTtlMs ?? 300_000
	return {
		heartbeatIntervalMs: options.heartbeatIntervalMs ?? Math.floor(jobLeaseTtlMs / 3),
		jobLeaseTtlMs,
		leaderId: options.leaderId ?? null,
		leaderLeaseTtlMs: options.leaderLeaseTtlMs ?? 30_000,
		maxRecoveries: options.maxRecoveries ?? 3,
		requireConcurrencyControl: options.requireConcurrencyControl ?? false,
		serverlessMaxDurationMs: options.serverless?.maxDurationMs ?? null,
		sweepIntervalMs: options.sweepIntervalMs ?? 60_000,
	}
}
