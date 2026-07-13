export type DrainDeps = {
	/**
	 * Stop the worker's interval loops (stop claiming new jobs). Resolves once any
	 * in-flight tick has settled, so no run-loop write can outlive the drain.
	 */
	stopLoops: () => Promise<void>
	/** Count this node's in-flight jobs (processing and claimed by it). */
	countInFlight: () => Promise<number>
	/** Requeue this node's remaining in-flight jobs. Returns how many were released. */
	requeueStragglers: () => Promise<number>
	/** Release the held scheduler and sweeper leadership leases. */
	releaseLeadership: () => Promise<void>
	/** Destroy the Payload instance (stops crons, closes the DB). */
	destroy: () => Promise<void>
	/** Wall-clock milliseconds (real in production, virtual in tests). */
	now: () => number
	/** Wait `ms` (real in production, virtual in tests). */
	sleep: (ms: number) => Promise<void>
	logger?: { info?: (m: string) => void }
}

export type DrainOptions = {
	/** Max wall-clock time to await in-flight jobs before requeuing stragglers. */
	drainTimeoutMs: number
	/** How often to re-count in-flight jobs while draining. */
	pollIntervalMs: number
}

export type DrainResult = {
	inFlightAtStart: number
	remaining: number
	requeued: number
	timedOut: boolean
}

/**
 * Run the graceful-drain sequence: stop claiming, await this node's in-flight jobs up
 * to a wall-clock budget, requeue any stragglers, release leadership, and destroy. The
 * clock (`now`/`sleep`) is injected so tests drive it deterministically without real
 * waiting. Always releases leadership and destroys, even when nothing was in flight.
 */
export const drainWorker = async (deps: DrainDeps, options: DrainOptions): Promise<DrainResult> => {
	// Stops claiming immediately. The settle promise is awaited bounded before
	// destroy(): a tick mid-write gets to land, but a long-running handler must not
	// block shutdown (its job is requeued as a straggler instead).
	const loopsSettled = deps.stopLoops()
	// Release leadership before the polling loop so other nodes can elect a new
	// leader during the drain window rather than waiting for the full timeout.
	await deps.releaseLeadership()
	const start = deps.now()
	const inFlightAtStart = await deps.countInFlight()
	let remaining = inFlightAtStart
	while (remaining > 0 && deps.now() - start < options.drainTimeoutMs) {
		await deps.sleep(options.pollIntervalMs)
		if (deps.now() - start >= options.drainTimeoutMs) {
			break
		}
		remaining = await deps.countInFlight()
	}
	const timedOut = remaining > 0
	// Only on timeout, to abandon still-running handlers. On a clean drain a just-finished
	// job can still read processing:true before its completion write lands; requeuing it
	// would bump recoveryAttempts and re-run it. The sweeper recovers genuine orphans.
	const requeued = timedOut ? await deps.requeueStragglers() : 0
	await Promise.race([loopsSettled, deps.sleep(options.pollIntervalMs)])
	await deps.destroy()
	deps.logger?.info?.(
		`@10x-media/jobs: drain complete (started ${inFlightAtStart}, requeued ${requeued}, timedOut ${timedOut})`
	)
	return { inFlightAtStart, remaining, requeued, timedOut }
}
