import { cronSecretAccess } from '../queueControl/access'
import type { QueueControlOptions } from '../queueControl/options'
import type { ReliabilityOptions } from '../reliability/options'

/** The option groups a topology preset configures. */
export type TopologyPreset = {
	reliability: ReliabilityOptions
	queueControl: QueueControlOptions
}

/**
 * Single-node Docker: one serial claimer, so claim races are moot. Reliability and
 * queue control on with defaults; the sweeper runs from the in-process worker.
 */
export const singleNodePreset = (): TopologyPreset => ({ queueControl: {}, reliability: {} })

/**
 * Multi-node Docker: leader-elected scheduling and sweeping (the default). Pass a
 * stable `leaderId` per node if you do not want the generated hostname:pid identity.
 */
export const multiNodePreset = (options: { leaderId?: string } = {}): TopologyPreset => ({
	queueControl: {},
	reliability: options.leaderId === undefined ? {} : { leaderId: options.leaderId },
})

/**
 * Serverless (Vercel): no long-running worker, so staleness derives from the platform
 * hard-kill duration (the function maxDuration) rather than a heartbeat, and the run
 * and sweep endpoints are guarded by the cron secret. Drive them with Vercel Cron
 * (see `vercelCrons`).
 */
export const serverlessPreset = (options: {
	maxDurationMs: number
	cronSecretEnvVar?: string
}): TopologyPreset => ({
	queueControl: { access: cronSecretAccess({ envVar: options.cronSecretEnvVar }) },
	reliability: {
		jobLeaseTtlMs: options.maxDurationMs,
		serverless: { maxDurationMs: options.maxDurationMs },
	},
})

/** A `vercel.json` `crons` entry. */
export type VercelCron = { path: string; schedule: string }

/**
 * Build the `vercel.json` `crons` array: one entry hitting the hardened run endpoint
 * (all queues) and one hitting the sweep endpoint. Defaults to every minute (Vercel
 * Pro). Vercel sends the `CRON_SECRET` as a Bearer token, which `cronSecretAccess`
 * checks.
 */
export const vercelCrons = (
	options: {
		runPath?: string
		sweepPath?: string
		runSchedule?: string
		sweepSchedule?: string
	} = {}
): VercelCron[] => [
	{
		path: options.runPath ?? '/api/payload-jobs/queue-run?allQueues=true',
		schedule: options.runSchedule ?? '* * * * *',
	},
	{
		path: options.sweepPath ?? '/api/payload-jobs/queue-sweep',
		schedule: options.sweepSchedule ?? '* * * * *',
	},
]
