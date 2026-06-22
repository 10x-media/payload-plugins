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

/**
 * Resume a paused queue or clear the global pause flag.
 *
 * The pause model has two independent layers: a global flag and a per-queue set.
 * `resume()` with no arguments (or `queue: undefined`) only clears the global flag;
 * per-queue pauses set with `pause('emails')` remain active. Pass `all: true` to
 * reset both layers at once to `emptyPauseState()`.
 *
 * Example: `pause('emails')` -> `pause()` -> `resume()` leaves emails paused.
 * Use `resume(undefined, true)` or `resume({ all: true })` for a full reset.
 */
export const applyResume = (
	state: PauseState,
	queue: string | undefined,
	all = false
): PauseState => {
	if (all) {
		return emptyPauseState()
	}
	if (queue === undefined) {
		return { ...state, global: false }
	}
	return { ...state, queues: state.queues.filter((q) => q !== queue) }
}

/** Whether `queue` is currently paused (a global pause covers every queue). */
export const isPaused = (state: PauseState, queue: string): boolean =>
	state.global || state.queues.includes(queue)
