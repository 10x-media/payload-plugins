import type { InterruptClassifier, JobsRegistry, RunGate } from '@10x-media/jobs'
import { type Config, getCurrentDate, type Payload } from 'payload'

import { isContentLockedError } from '../enforcement/ContentLockedError'
import { getContentLockState } from '../state/store'

/** How jobs deferred by a lock are tagged, and the name `resumeDeferred` releases them by. */
export const JOBS_DEFERRED_BY = 'content-lock'

/** How long a job interrupted by a lock without a known end waits before trying again. */
const UNKNOWN_END_MS = 5 * 60 * 1000

/** Integration with `@10x-media/jobs`. */
export type ContentLockJobsOptions = {
	/**
	 * Queues any active lock pauses, even one that freezes only part of the
	 * content. A lock on everything pauses every queue regardless. Jobs in
	 * running queues are interrupted when they write into the lock.
	 */
	queues?: string[]
}

const JOBS_KEY = '@10x-media/jobs'

const registryOf = (config: Pick<Config, 'custom'>): JobsRegistry | undefined => {
	const registry = config.custom?.[JOBS_KEY] as JobsRegistry | undefined
	return Array.isArray(registry?.extensions?.runGates) ? registry : undefined
}

const lockGate =
	(queues: string[] | undefined): RunGate =>
	async ({ payload }) => {
		const state = await getContentLockState(payload)
		if (!state.locked) {
			return null
		}
		const paused = state.scope.everything ? 'all' : queues
		if (!paused?.length) {
			return null
		}
		return {
			by: JOBS_DEFERRED_BY,
			paused,
			until: state.endsAt ? new Date(state.endsAt) : null,
		}
	}

const lockInterruption: InterruptClassifier = ({ error }) => {
	if (!isContentLockedError(error)) {
		return null
	}
	const endsAt = error.data?.endsAt
	return {
		by: JOBS_DEFERRED_BY,
		until: endsAt ? new Date(endsAt) : new Date(getCurrentDate().getTime() + UNKNOWN_END_MS),
	}
}

/**
 * Register the lock with `@10x-media/jobs` when it is installed: a lock on
 * everything pauses every queue (a partial lock only the `queues` listed), and
 * a job a lock stops mid-run is recognised as interrupted rather than failed.
 * Returns whether the integration is on.
 */
export const registerJobsIntegration = (
	config: Config,
	options: ContentLockJobsOptions | false | undefined,
	hasJobsPlugin: boolean
): boolean => {
	if (options === false) {
		return false
	}
	const registry = hasJobsPlugin ? registryOf(config) : undefined
	if (!registry) {
		if (options) {
			const priorOnInit = config.onInit
			config.onInit = async (payload) => {
				await priorOnInit?.(payload)
				payload.logger.warn(
					'[content-lock] `jobs` is set but @10x-media/jobs is not installed; ignoring it'
				)
			}
		}
		return false
	}
	registry.extensions.runGates.push(lockGate(options?.queues))
	registry.extensions.interruptOn.push(lockInterruption)
	return true
}

/**
 * Release the jobs a lock deferred, after any change to a window: "End now" or
 * a moved end frees them within one worker tick instead of at the old end.
 * Early is safe: a queue the lock still pauses stays unclaimed. Never fails the
 * window save.
 */
export const resumeLockDeferredJobs = async (payload: Payload): Promise<void> => {
	const registry = registryOf(payload.config)
	if (!registry) {
		return
	}
	try {
		await registry.api.resumeDeferred(payload, JOBS_DEFERRED_BY)
	} catch (error) {
		payload.logger.error({ err: error, msg: '[content-lock] cannot resume deferred jobs' })
	}
}
