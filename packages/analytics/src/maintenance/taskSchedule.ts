import type { TaskConfig } from 'payload'
import type { AnalyticsTaskName, ScheduledTask } from '../core/jobs'

/**
 * How long one sync or warm run works before it leaves the rest to the next, as maintenance does:
 * under the 300 seconds a serverless route serving Payload's run endpoint is given.
 */
export const TASK_BUDGET_MS = 240_000

/**
 * A task's schedule as `jobs` resolved it: none when it is unscheduled, else one on its queue.
 * Payload's own rule decides each slot (no second run while one is queued or holds its processing
 * lease); a killed run's lease lapses and the next worker picks the same job up again.
 */
export const scheduleFor = (task: ScheduledTask): Pick<TaskConfig, 'schedule'> =>
	task.cron === null ? {} : { schedule: [{ cron: task.cron, queue: task.queue }] }

type Concurrency = NonNullable<TaskConfig['concurrency']>

/** `analytics:<task>`, one run at a time, without `supersedes`, which would delete a queued run once the next is scheduled. */
export const concurrencyFor = (
	name: AnalyticsTaskName,
	keyOf?: (input: unknown) => string
): Pick<TaskConfig, 'concurrency'> => {
	const concurrency: Concurrency = {
		key: ({ input }) => keyOf?.(input) ?? `analytics:${name}`,
		exclusive: true,
		supersedes: false,
	}
	return { concurrency }
}
