import type { TaskConfig, WorkflowConfig } from 'payload'

import type { ReliabilityOptions } from '../src/index'

/**
 * Reliability tuning shared by the dev app and the worker entrypoint. Short TTLs so
 * the e2e drains and recovers quickly.
 */
export const RELIABILITY_OPTIONS: ReliabilityOptions = {
	jobLeaseTtlMs: 10_000,
	leaderLeaseTtlMs: 5_000,
	sweepIntervalMs: 2_000,
}

/**
 * Tasks are typed by their inline input/output shape rather than a slug, because the
 * dev app's generated `TypedJobs['tasks']` registry does not list these e2e tasks (we
 * do not regenerate dev types), so a slug-typed `TaskConfig` would resolve its output to
 * `never`. The inline shape keeps `slug` a free string and `output` an open object.
 */
type E2ETask = TaskConfig<{ input: object; output: object }>

const sleepTask: E2ETask = {
	slug: 'sleep',
	label: 'Sleep',
	handler: async ({ job }) => {
		const ms = Number((job.input as { ms?: number })?.ms ?? 100)
		await new Promise((resolve) => {
			setTimeout(resolve, ms)
		})
		return { output: {} }
	},
}

/**
 * Nightly schedule demos the queue-select auto-discovery: 'maintenance' isn't in
 * queueControl.queues. Payload 3.85 does not re-export ScheduleConfig from its root,
 * so the type is derived from TaskConfig's schedule field.
 */
const noopSchedule: NonNullable<E2ETask['schedule']> = [{ cron: '0 3 * * *', queue: 'maintenance' }]

const noopTask: E2ETask = {
	slug: 'noop',
	label: 'No-op',
	schedule: noopSchedule,
	handler: () => ({ output: {} }),
}

/** A sleep task (drain e2e) and a noop task. Sleep duration comes from `input.ms`. */
export const e2eTasks: E2ETask[] = [sleepTask, noopTask]

/**
 * Matches the seeded `workflowSlug: 'runAutomation'` jobs (see dev/helpers/seed.ts) so the
 * workflow select has a real option in dev. Uses `inlineTask` rather than `tasks.noop`
 * because dev's generated `TypedJobs['tasks']` is stale (`unknown`), which would make
 * `noop` resolve to a non-existent property.
 */
export const e2eWorkflows: WorkflowConfig[] = [
	{
		slug: 'runAutomation',
		label: 'Run automation',
		handler: async ({ inlineTask }) => {
			await inlineTask('1', { task: () => ({ output: {} }) })
		},
	},
]
