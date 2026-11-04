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
 * queue control on with defaults.
 */
export const singleNodePreset = (): TopologyPreset => ({ queueControl: {}, reliability: {} })

/**
 * Multi-node Docker: leader-elected scheduling (the default). Pass a
 * stable `leaderId` per node if you do not want the generated hostname:pid identity.
 */
export const multiNodePreset = (options: { leaderId?: string } = {}): TopologyPreset => ({
	queueControl: {},
	reliability: options.leaderId === undefined ? {} : { leaderId: options.leaderId },
})

/**
 * Serverless (Vercel): no long-running worker, so the run endpoint is guarded by the
 * cron secret and driven by Vercel Cron (see `vercelCrons`). A function killed at its
 * `maxDuration` stops renewing Payload's job lease, and the job is claimable again
 * once `jobs.processingLease.duration` passes: set that near your `maxDuration`.
 */
export const serverlessPreset = (options: { cronSecretEnvVar?: string } = {}): TopologyPreset => ({
	queueControl: { access: cronSecretAccess({ envVar: options.cronSecretEnvVar }) },
	reliability: {},
})

/** A `vercel.json` `crons` entry. */
export type VercelCron = { path: string; schedule: string }

/**
 * Build the `vercel.json` `crons` array: one entry hitting the hardened run endpoint
 * (all queues). Defaults to every minute (Vercel Pro). Vercel sends the `CRON_SECRET`
 * as a Bearer token, which `cronSecretAccess` checks.
 */
export const vercelCrons = (
	options: { runPath?: string; runSchedule?: string } = {}
): VercelCron[] => [
	{
		path: options.runPath ?? '/api/payload-jobs/queue-run?allQueues=true',
		schedule: options.runSchedule ?? '* * * * *',
	},
]
