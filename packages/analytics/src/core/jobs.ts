import { STATE_SLUG } from '../native/collections/slugs'
import {
	type AnalyticsCollectionOptions,
	type ResolvedCollectionOption,
	resolveCollectionOption,
} from './collectionOption'
import { cronIntervalMs, isCronPattern } from './cron'
import { optionsObject } from './optionChecks'
import { isOneOf, isRecord, kindOf } from './values'

/** When one of the plugin's tasks runs, and on which queue. */
export type AnalyticsTaskOptions = {
	/** The queue its scheduled runs are queued on; `jobs.queue` by default. */
	queue?: string
	/** When it is scheduled. `false` registers it unscheduled, to run only when something queues it. */
	cron?: string | false
}

/** The plugin's background tasks, registered with Payload's jobs queue. */
export type AnalyticsJobsOptions = {
	/** The queue every task is scheduled on unless its own entry names another. Default `'default'`. */
	queue?: string
	tasks?: {
		/** `analytics-maintain`, the native engine's upkeep, registered with `native()`. Every 15 minutes by default. */
		maintain?: AnalyticsTaskOptions
		/** `analytics-sync`, registered with `sync`. Every six hours by default. */
		sync?: AnalyticsTaskOptions
		/** `analytics-warm`, registered with `cache.warm`. Every 30 minutes by default. */
		warm?: AnalyticsTaskOptions
	}
	/**
	 * The `analytics-state` collection holding the sync and warm tasks' leases, on an install without
	 * `native()`; with `native()` the engine registers it and this is refused.
	 */
	state?: AnalyticsCollectionOptions
}

/** The tasks `jobs.tasks` names, `maintain` first. */
export const TASK_NAMES = ['maintain', 'sync', 'warm'] as const

export type AnalyticsTaskName = (typeof TASK_NAMES)[number]

/** Each task's slug in Payload's jobs config, which is also its heartbeat's and its lease's name. */
export const TASK_SLUGS: {
	readonly maintain: 'analytics-maintain'
	readonly sync: 'analytics-sync'
	readonly warm: 'analytics-warm'
} = {
	maintain: 'analytics-maintain',
	sync: 'analytics-sync',
	warm: 'analytics-warm',
}

/** One task as registered: its queue, its schedule (null when unscheduled) and its cadence. */
export interface ScheduledTask {
	queue: string
	cron: string | null
	/** How far apart its runs fall, which its heartbeat is judged by. */
	intervalMs: number
}

/** `jobs` resolved for every task, whether or not the install registers it. */
interface ResolvedJobTasks {
	maintain: ScheduledTask
	sync: ScheduledTask
	warm: ScheduledTask
	/** The tasks `jobs.tasks` gave an entry, which the boot holds against what the install registers. */
	configured: ReadonlySet<AnalyticsTaskName>
	/** `jobs.state`, present only when the install set it. */
	state?: ResolvedCollectionOption
}

/** `jobs` resolved: false registers none of the plugin's tasks, whose work then happens on requests. */
export type ResolvedJobs = false | ResolvedJobTasks

/**
 * The plugin's `jobs` as an adapter is handed it: each task's queue and schedule, or false when the
 * install registers no task and the adapter's own requests do that work instead.
 */
export type AdapterJobs = false | Readonly<Record<AnalyticsTaskName, ScheduledTask>>

const DEFAULT_JOBS_QUEUE = 'default'

export const MAINTAIN_INTERVAL_MS = 15 * 60_000

export const SYNC_INTERVAL_MS = 6 * 3_600_000

export const WARM_INTERVAL_MS = 30 * 60_000

const DEFAULT_SCHEDULES: Readonly<Record<AnalyticsTaskName, { cron: string; intervalMs: number }>> =
	{
		maintain: { cron: '*/15 * * * *', intervalMs: MAINTAIN_INTERVAL_MS },
		sync: { cron: '0 */6 * * *', intervalMs: SYNC_INTERVAL_MS },
		warm: { cron: '*/30 * * * *', intervalMs: WARM_INTERVAL_MS },
	}

const defaultTask = (name: AnalyticsTaskName, queue: string): ScheduledTask => ({
	queue,
	cron: DEFAULT_SCHEDULES[name].cron,
	intervalMs: DEFAULT_SCHEDULES[name].intervalMs,
})

export const DEFAULT_JOBS: ResolvedJobTasks = {
	maintain: defaultTask('maintain', DEFAULT_JOBS_QUEUE),
	sync: defaultTask('sync', DEFAULT_JOBS_QUEUE),
	warm: defaultTask('warm', DEFAULT_JOBS_QUEUE),
	configured: new Set(),
}

const isTaskName = (name: string): name is AnalyticsTaskName => isOneOf(TASK_NAMES, name)

const refuse = (message: string): never => {
	throw new Error(`analytics: ${message}`)
}

const queueOf = (value: unknown, path: string): string | undefined => {
	if (value === undefined) {
		return undefined
	}
	if (typeof value !== 'string' || value.trim() === '') {
		return refuse(`${path} must be a queue name, got ${kindOf(value)}`)
	}
	return value.trim()
}

const taskOf = (value: unknown, name: AnalyticsTaskName, defaultQueue: string): ScheduledTask => {
	const path = `jobs.tasks.${name}`
	if (value === undefined) {
		return defaultTask(name, defaultQueue)
	}
	const { cron, queue } = optionsObject(value, {
		path,
		known: ['queue', 'cron'],
		example: "an object such as { cron: '0 * * * *' }",
	})
	if (cron !== undefined && cron !== false && !isCronPattern(cron)) {
		refuse(
			`${path}.cron must be a cron pattern of five fields (six with seconds first) or a nickname such as '@hourly', or false to leave the task unscheduled, got ${kindOf(cron)}`
		)
	}
	const fallback = DEFAULT_SCHEDULES[name]
	const schedule = cron === false ? null : typeof cron === 'string' ? cron.trim() : fallback.cron
	return {
		queue: queueOf(queue, `${path}.queue`) ?? defaultQueue,
		cron: schedule,
		intervalMs: (schedule === null ? null : cronIntervalMs(schedule)) ?? fallback.intervalMs,
	}
}

/**
 * `jobs` checked at boot: every task resolved to its queue and schedule. Which of them the install
 * registers follows `native()`, `sync` and `cache.warm`; `false` registers none.
 */
export const resolveJobs = (option: unknown): ResolvedJobs => {
	if (option === false) {
		return false
	}
	if (option === undefined) {
		return DEFAULT_JOBS
	}
	const shaped = optionsObject(option, {
		path: 'jobs',
		known: ['queue', 'tasks', 'state'],
		example: "false, to register no task, or an object such as { queue: 'analytics' }",
	})
	const queue = queueOf(shaped.queue, 'jobs.queue') ?? DEFAULT_JOBS_QUEUE
	const tasks = shaped.tasks ?? {}
	if (!isRecord(tasks) || Array.isArray(tasks)) {
		return refuse(
			`jobs.tasks must be an object such as { maintain: { cron: false } }, got ${kindOf(tasks)}`
		)
	}
	const configured = new Set<AnalyticsTaskName>()
	for (const name of Object.keys(tasks)) {
		if (!isTaskName(name)) {
			return refuse(`jobs.tasks.${name} is not a task; the tasks are ${TASK_NAMES.join(', ')}`)
		}
		if (tasks[name] !== undefined) {
			configured.add(name)
		}
	}
	const of = (name: AnalyticsTaskName): ScheduledTask => taskOf(tasks[name], name, queue)
	const state =
		shaped.state === undefined
			? undefined
			: resolveCollectionOption(shaped.state, { path: 'jobs.state', fallback: STATE_SLUG })
	return {
		maintain: of('maintain'),
		sync: of('sync'),
		warm: of('warm'),
		configured,
		...(state ? { state } : {}),
	}
}

/** What the install asks to run, which `jobs` has to be able to register. */
interface JobsDemand {
	sync: boolean
	warm: boolean
}

/**
 * Refuses a `jobs` that contradicts what the install turned on: `false` beside a feature whose only
 * worker is a task, or a task's entry for a feature that is off and so registers no task.
 */
export const assertJobsFit = (jobs: ResolvedJobs, demand: JobsDemand): void => {
	if (jobs === false) {
		const needs = [
			...(demand.sync ? ['sync, which only the analytics-sync task fills'] : []),
			...(demand.warm ? ['cache.warm, which only the analytics-warm task runs'] : []),
		]
		if (needs.length > 0) {
			refuse(
				`jobs: false registers no task, but this install turns on ${needs.join(' and ')}. Turn ${needs.length === 1 ? 'it' : 'them'} off, or replace jobs: false with entries such as jobs: { tasks: { sync: { cron: false } } } to register a task unscheduled and queue it yourself.`
			)
		}
		return
	}
	if (jobs.configured.has('sync') && !demand.sync) {
		refuse(
			'jobs.tasks.sync schedules analytics-sync, which is registered only while sync is on. Turn sync on, or remove the entry.'
		)
	}
	if (jobs.configured.has('warm') && !demand.warm) {
		refuse(
			'jobs.tasks.warm schedules analytics-warm, which is registered only while cache.warm is on. Turn cache.warm on, or remove the entry.'
		)
	}
}

/**
 * Refuses `jobs.tasks.maintain` on an install that registered no `analytics-maintain`, checked once
 * the adapters have registered what they run.
 */
export const assertMaintainRegistered = (jobs: ResolvedJobs, registered: boolean): void => {
	if (jobs !== false && jobs.configured.has('maintain') && !registered) {
		refuse(
			'jobs.tasks.maintain schedules analytics-maintain, which only native() registers. Add native() to adapters, or remove the entry.'
		)
	}
}
