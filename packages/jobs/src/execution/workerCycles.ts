type Logger = { error?: (m: string) => void }

const guard = async (
	logger: Logger | undefined,
	label: string,
	fn: () => Promise<void>
): Promise<void> => {
	try {
		await fn()
	} catch (err) {
		logger?.error?.(`@10x-media/jobs: worker ${label} cycle error: ${String(err)}`)
	}
}

export type RunCycleDeps = { runJobs: () => Promise<void>; logger?: Logger }

/** One run cycle: claim and execute jobs on this node. Errors are logged, not thrown. */
export const runCycle = async (deps: RunCycleDeps): Promise<void> => {
	await guard(deps.logger, 'run', deps.runJobs)
}

export type MaintenanceCycleDeps = {
	tickLeaders: (now: Date) => Promise<void>
	isSchedulerLeader: () => boolean
	handleSchedules: () => Promise<void>
	now: () => Date
	logger?: Logger
}

/** One maintenance cycle: advance leadership, then schedule only if scheduler-leader. */
export const maintenanceCycle = async (deps: MaintenanceCycleDeps): Promise<void> => {
	await guard(deps.logger, 'leadership', () => deps.tickLeaders(deps.now()))
	if (deps.isSchedulerLeader()) {
		await guard(deps.logger, 'schedule', deps.handleSchedules)
	}
}

export type SweepCycleDeps = {
	isSweeperLeader: () => boolean
	sweep: () => Promise<void>
	logger?: Logger
}

/** One sweep cycle: reclaim stuck jobs only if sweeper-leader. */
export const sweepCycle = async (deps: SweepCycleDeps): Promise<void> => {
	if (deps.isSweeperLeader()) {
		await guard(deps.logger, 'sweep', deps.sweep)
	}
}
