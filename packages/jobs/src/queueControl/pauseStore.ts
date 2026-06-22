import type { Payload } from 'payload'

import { applyPause, applyResume, emptyPauseState, isPaused, type PauseState } from './pauseState'

const PAUSE_KEY = '@10x-media/jobs:pause-state'

/** A durable, cluster-wide pause store backed by `payload.kv`. */
export type PauseStore = {
	pause: (queue?: string) => Promise<void>
	/**
	 * Resume a named queue, clear the global flag, or reset everything.
	 * Pass `{ all: true }` to reset both layers at once (equivalent to `emptyPauseState()`).
	 */
	resume: (queueOrOpts?: string | { all: true }) => Promise<void>
	getState: () => Promise<PauseState>
	isPaused: (queue: string) => Promise<boolean>
}

/**
 * Build the pause store over `payload.kv` (always available, durable, cluster-wide).
 * Pause and resume read-modify-write the single state value; this is last-writer-wins
 * (kv has no atomic compare-and-set), which is acceptable for rare admin actions.
 */
const isValidPauseState = (raw: unknown): raw is PauseState =>
	typeof raw === 'object' &&
	raw !== null &&
	'global' in raw &&
	typeof (raw as PauseState).global === 'boolean' &&
	Array.isArray((raw as PauseState).queues)

export const createPauseStore = (payload: Payload): PauseStore => {
	const getState = async (): Promise<PauseState> => {
		const raw = await payload.kv.get<unknown>(PAUSE_KEY)
		return isValidPauseState(raw) ? raw : emptyPauseState()
	}

	return {
		getState,
		isPaused: async (queue) => isPaused(await getState(), queue),
		pause: async (queue) => {
			await payload.kv.set(PAUSE_KEY, applyPause(await getState(), queue))
		},
		resume: async (queueOrOpts) => {
			const all =
				typeof queueOrOpts === 'object' && queueOrOpts !== null && queueOrOpts.all === true
			const queue = typeof queueOrOpts === 'string' ? queueOrOpts : undefined
			await payload.kv.set(PAUSE_KEY, applyResume(await getState(), queue, all))
		},
	}
}
