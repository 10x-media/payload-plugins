import type { InterruptClassifier, RunGate } from '@10x-media/jobs'
import { type Config, getCurrentDate } from 'payload'

import { isContentLockedError } from '../enforcement/ContentLockedError'
import { getContentLockState } from '../state/store'
import { deferredByWindow, jobsRegistryOf } from './deferred'

/**
 * How long a job deferred by a lock without a known end waits. Ending or
 * changing the window releases it sooner; this only bounds a missed release.
 */
const UNKNOWN_END_MS = 24 * 60 * 60 * 1000

/**
 * How long a job waits when the lock that stopped it names no window: the lock
 * state could not be read and the guard failed closed, so no window change can
 * release the job. A minute outlasts a kv or database blip; while the state
 * stays unreadable the run gate throws and the jobs worker claims nothing.
 */
const UNREADABLE_STATE_RETRY_MS = 60 * 1000

const fromNow = (ms: number) => new Date(getCurrentDate().getTime() + ms)

/** Integration with `@10x-media/jobs`. */
export type ContentLockJobsOptions = {
	/**
	 * Queues any active lock pauses, even one that freezes only part of the
	 * content. A lock on everything pauses every queue regardless. Jobs in
	 * running queues are interrupted when they write into the lock.
	 */
	queues?: string[]
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
		const pausing =
			(state.scope.everything
				? state.active.find((window) => window.scope === 'everything')
				: undefined) ?? state.active[0]
		return {
			by: deferredByWindow(pausing?.id),
			paused,
			until: state.endsAt ? new Date(state.endsAt) : fromNow(UNKNOWN_END_MS),
		}
	}

const lockInterruption: InterruptClassifier = ({ error }) => {
	if (!isContentLockedError(error)) {
		return null
	}
	// Any covering window will do: resumed early by the wrong one, the job hits
	// the other lock and is deferred again under its id.
	const windowId = error.data?.lockIds?.[0]
	if (!windowId) {
		return { by: deferredByWindow(undefined), until: fromNow(UNREADABLE_STATE_RETRY_MS) }
	}
	const endsAt = error.data?.endsAt
	return {
		by: deferredByWindow(windowId),
		until: endsAt ? new Date(endsAt) : fromNow(UNKNOWN_END_MS),
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
	const registry = hasJobsPlugin ? jobsRegistryOf(config) : undefined
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
