import type { JobsConfig } from 'payload'

/**
 * Payload's per-cron autoRun config. Payload 3.85.0 does not re-export the
 * `AutorunCronConfig` type from its package root, so derive it from the array branch of
 * the publicly exported `JobsConfig['autoRun']` (which Payload types as that element).
 */
export type AutorunCronConfig = Extract<NonNullable<JobsConfig['autoRun']>, unknown[]>[number]

/** One logical queue's autoRun cadence. */
export type AutoRunQueueConfig = {
	queue: string
	/** Cron cadence for this queue. Default every minute. */
	cron?: string
	/** Max jobs claimed per tick. Default 10. */
	limit?: number
}

export type AutoRunConfigOptions = {
	/** One entry per logical queue. Default a single `default` queue. */
	queues?: AutoRunQueueConfig[]
	/** Suppress per-run info logging. Default true. */
	silent?: boolean
	/**
	 * Disable native auto-scheduling on these crons. Default false. Set true when a
	 * `createWorker` owns scheduling (multi-node), so the cron only runs jobs.
	 */
	disableScheduling?: boolean
}

const DEFAULT_CRON = '* * * * *'
const DEFAULT_LIMIT = 10

/**
 * Build a production `jobs.autoRun` array: one Croner config per queue, silent by
 * default, with Payload's own `protect: true` preventing overlap. This is the simple
 * single-node and serverless-adjacent path where native autoRun safely handles both
 * scheduling and running in one process. Multi-node deployments use `createWorker`
 * instead, because native autoRun cannot gate scheduling to one elected leader (its
 * only dynamic lever, `shouldAutoRun`, permanently stops the cron rather than pausing).
 */
export const autoRunConfig = (options: AutoRunConfigOptions = {}): AutorunCronConfig[] => {
	const { disableScheduling = false, queues = [{ queue: 'default' }], silent = true } = options
	return queues.map((q) => ({
		cron: q.cron ?? DEFAULT_CRON,
		disableScheduling,
		limit: q.limit ?? DEFAULT_LIMIT,
		queue: q.queue,
		silent,
	}))
}
