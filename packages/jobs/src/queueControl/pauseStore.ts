import type { Payload } from 'payload'

import { applyPause, applyResume, emptyPauseState, isPaused, type PauseState } from './pauseState'

const PAUSE_KEY = '@10x-media/jobs:pause-state'

/** A durable, cluster-wide pause store backed by `payload.kv`. */
export type PauseStore = {
	pause: (queue?: string) => Promise<void>
	resume: (queue?: string) => Promise<void>
	getState: () => Promise<PauseState>
	isPaused: (queue: string) => Promise<boolean>
}

/**
 * Build the pause store over `payload.kv` (always available, durable, cluster-wide).
 * Pause and resume read-modify-write the single state value; this is last-writer-wins
 * (kv has no atomic compare-and-set), which is acceptable for rare admin actions.
 */
export const createPauseStore = (payload: Payload): PauseStore => {
	const getState = async (): Promise<PauseState> =>
		(await payload.kv.get<PauseState>(PAUSE_KEY)) ?? emptyPauseState()

	return {
		getState,
		isPaused: async (queue) => isPaused(await getState(), queue),
		pause: async (queue) => {
			await payload.kv.set(PAUSE_KEY, applyPause(await getState(), queue))
		},
		resume: async (queue) => {
			await payload.kv.set(PAUSE_KEY, applyResume(await getState(), queue))
		},
	}
}
