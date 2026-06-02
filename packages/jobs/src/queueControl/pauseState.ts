/** Cluster-wide pause state: a global pause plus a set of paused queue names. */
export type PauseState = { global: boolean; queues: string[] }

/** The default (nothing paused) state. */
export const emptyPauseState = (): PauseState => ({ global: false, queues: [] })

/** Pause everything (no queue) or a single queue (idempotent). */
export const applyPause = (state: PauseState, queue: string | undefined): PauseState => {
	if (queue === undefined) {
		return { ...state, global: true }
	}
	return state.queues.includes(queue) ? state : { ...state, queues: [...state.queues, queue] }
}

/** Resume everything (no queue, clears the global flag) or a single queue. */
export const applyResume = (state: PauseState, queue: string | undefined): PauseState => {
	if (queue === undefined) {
		return { ...state, global: false }
	}
	return { ...state, queues: state.queues.filter((q) => q !== queue) }
}

/** Whether `queue` is currently paused (a global pause covers every queue). */
export const isPaused = (state: PauseState, queue: string): boolean =>
	state.global || state.queues.includes(queue)
