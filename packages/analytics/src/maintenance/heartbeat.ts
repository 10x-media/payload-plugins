import type { ScheduledTask } from '../core/jobs'
import type { TaskStateStore } from '../native/store/types'

/** How often one instance reads a task's heartbeat at most, however many reads it serves. */
export const HEARTBEAT_CHECK_EVERY_MS = 10 * 60_000

export interface HeartbeatWatch {
	/**
	 * Reads the task's heartbeat in the background unless this instance did within the check
	 * interval, and warns once when it is more than two intervals old. Never rejects.
	 */
	maybeCheck(): void
	/** Settles once a check in flight has finished. */
	idle(): Promise<void>
}

export interface HeartbeatWatchOptions {
	/** The task's slug, which its heartbeat is stored under. */
	task: string
	schedule: ScheduledTask
	state: () => TaskStateStore | undefined
	/** Epoch milliseconds. */
	now: () => number
	warn: (message: string) => void
	checkEveryMs?: number
}

const hoursOf = (ms: number): string => {
	const hours = ms / 3_600_000
	return hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(ms / 60_000)} minutes`
}

/**
 * Warns once when a task with no fallback last ran, or has not run since this instance started,
 * more than two intervals ago; a run seen again re-arms it. An unscheduled task is not watched.
 */
export const createHeartbeatWatch = (options: HeartbeatWatchOptions): HeartbeatWatch => {
	const checkEvery = options.checkEveryMs ?? HEARTBEAT_CHECK_EVERY_MS
	const startedAt = options.now()
	const { intervalMs, cron, queue } = options.schedule
	let checkedAt: number | undefined
	let running: Promise<void> | undefined
	let warned = false

	const check = async (): Promise<void> => {
		const state = options.state()
		if (!state) {
			return
		}
		const beat = await state.lastBeat(options.task)
		const at = options.now()
		const since = beat?.getTime() ?? startedAt
		if (at - since <= 2 * intervalMs) {
			warned = false
			return
		}
		if (warned) {
			return
		}
		warned = true
		const last = beat
			? `last finished ${hoursOf(at - since)} ago`
			: `has not finished since this server started ${hoursOf(at - startedAt)} ago`
		options.warn(
			`analytics: ${options.task} ${last}, though it is scheduled every ${hoursOf(intervalMs)}. Check that a job runner works the "${queue}" queue; nothing else does this task's work.`
		)
	}

	return {
		maybeCheck() {
			if (cron === null || running) {
				return
			}
			const at = options.now()
			if (checkedAt !== undefined && at - checkedAt < checkEvery) {
				return
			}
			checkedAt = at
			running = check()
				.catch((err: unknown) => {
					options.warn(`analytics: reading the ${options.task} heartbeat failed: ${String(err)}`)
				})
				.finally(() => {
					running = undefined
				})
		},
		idle: async () => {
			await running
		},
	}
}
