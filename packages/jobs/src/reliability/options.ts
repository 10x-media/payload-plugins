/**
 * Tuning for the jobs reliability layer. All durations are milliseconds.
 *
 * Payload 4 leases every claimed job itself (`jobs.processingLease`): its runner
 * renews the lease while a job runs, and a job whose worker died is claimable
 * again once the lease lapses. Tune that in the Payload config; this layer adds
 * the recovery cap and leader-elected scheduling on top.
 */
export type ReliabilityOptions = {
	/**
	 * How many times a job whose run died mid-handler (the worker crashed or was
	 * killed) is run again before it is dead-lettered. Default 3. Total
	 * executions = maxRecoveries + 1. Failures the handler throws are Payload's
	 * retries, not recoveries.
	 */
	maxRecoveries?: number
	/** How long the scheduler leadership lease is valid. Default 30000. */
	leaderLeaseTtlMs?: number
	/** A stable id for this node/process. Defaults to a generated value at runtime. */
	leaderId?: string
}

/** Reliability options with every value resolved. `null` means reliability is off. */
export type ResolvedReliabilityOptions = {
	maxRecoveries: number
	leaderLeaseTtlMs: number
	leaderId: string | null
}

/** Resolve user reliability options to a fully-defaulted object, or `null` when disabled. */
export const resolveReliabilityOptions = (
	options: ReliabilityOptions | boolean | undefined
): ResolvedReliabilityOptions | null => {
	if (options === undefined || options === false) {
		return null
	}
	// `true` enables the layer with every default; an object customizes it.
	const opts: ReliabilityOptions = options === true ? {} : options
	return {
		leaderId: opts.leaderId ?? null,
		leaderLeaseTtlMs: opts.leaderLeaseTtlMs ?? 30_000,
		maxRecoveries: opts.maxRecoveries ?? 3,
	}
}
