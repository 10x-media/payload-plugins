import type { Where } from 'payload'

import type { PauseState } from './pauseState'

/** A single `payload.jobs.run` target, honoring pause. */
export type RunTarget = { allQueues?: boolean; queue?: string; where?: Where }

/**
 * Compute the run targets for one cycle, given the worker's configured queues (or
 * undefined for all queues) and the current pause state. A global pause yields no
 * targets. A specific queue list drops the paused queues. All-queues running excludes
 * paused queues via `not_in` paired with `allQueues: true` (the exclusion requires
 * allQueues, because Payload's built-in single-queue filter only applies otherwise).
 */
export const runTargetsForPause = (
	queues: string[] | undefined,
	state: PauseState
): RunTarget[] => {
	if (state.global) {
		return []
	}
	if (queues && queues.length > 0) {
		return queues.filter((queue) => !state.queues.includes(queue)).map((queue) => ({ queue }))
	}
	if (state.queues.length > 0) {
		return [{ allQueues: true, where: { queue: { not_in: state.queues } } }]
	}
	return [{ allQueues: true }]
}
