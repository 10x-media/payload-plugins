import type { PayloadRequest, TaskConfig } from 'payload'
import { currentDate } from '../core/clock'
import type { AnalyticsTaskName, ScheduledTask } from '../core/jobs'

type Schedule = NonNullable<TaskConfig['schedule']>[number]

type ScheduleHooks = NonNullable<Schedule['hooks']>

export type BeforeSchedule = NonNullable<ScheduleHooks['beforeSchedule']>

/**
 * How long one sync or warm run works before it leaves the rest to the next, as maintenance does:
 * under the 300 seconds a serverless route serving Payload's run endpoint is given.
 */
export const TASK_BUDGET_MS = 240_000

/**
 * How long a sync or warm job may sit processing before it counts as killed, unless a live run
 * holds the task's lease: its budget, the read still out when it ran out, and a margin.
 */
export const TASK_DEAD_AFTER_MS = TASK_BUDGET_MS + 10 * 60_000

export interface StuckJobGuardOptions {
	slug: string
	/** A run still processing this long after its job last changed was killed. */
	deadAfterMs: number
	/**
	 * Whether a live run answers for the task right now (it holds the task's lease): no job is then
	 * marked, however old. Undefined where that cannot be known, which leaves the cutoff alone.
	 */
	alive?: (req: PayloadRequest) => Promise<boolean | undefined>
}

/**
 * Payload's rule (no second run while one is queued or processing), but a killed run is marked
 * failed first, since a job left `processing` would otherwise block every later schedule.
 */
export const stuckJobGuard =
	(options: StuckJobGuardOptions): BeforeSchedule =>
	async (args) => {
		const { queueable, req } = args
		if ((await options.alive?.(req)) !== true) {
			const cutoff = new Date(currentDate().getTime() - options.deadAfterMs)
			await req.payload.db.updateJobs({
				where: {
					and: [
						{ taskSlug: { equals: options.slug } },
						{ queue: { equals: queueable.scheduleConfig.queue } },
						{ processing: { equals: true } },
						{ completedAt: { exists: false } },
						{ hasError: { not_equals: true } },
						{ updatedAt: { less_than: cutoff.toISOString() } },
					],
				},
				data: {
					processing: false,
					hasError: true,
					error: {
						message: `analytics: stopped before it finished, and still processing after ${Math.round(options.deadAfterMs / 60_000)} minutes`,
					},
				},
				req,
				returning: false,
			})
		}
		return args.defaultBeforeSchedule(args)
	}

/** A task's schedule as `jobs` resolved it: none when it is unscheduled, else one on its queue. */
export const scheduleFor = (
	task: ScheduledTask,
	beforeSchedule: BeforeSchedule
): Pick<TaskConfig, 'schedule'> =>
	task.cron === null
		? {}
		: { schedule: [{ cron: task.cron, queue: task.queue, hooks: { beforeSchedule } }] }

type Concurrency = NonNullable<TaskConfig['concurrency']>

/**
 * `analytics:<task>`, one run at a time, without `supersedes`, which would delete failed jobs the
 * stuck guard marked. Payload refuses a key without `jobs.enableConcurrencyControl`.
 */
export const concurrencyFor = (
	name: AnalyticsTaskName,
	enabled: boolean,
	keyOf?: (input: unknown) => string
): Pick<TaskConfig, 'concurrency'> => {
	if (!enabled) {
		return {}
	}
	const concurrency: Concurrency = {
		key: ({ input }) => keyOf?.(input) ?? `analytics:${name}`,
		exclusive: true,
		supersedes: false,
	}
	return { concurrency }
}
