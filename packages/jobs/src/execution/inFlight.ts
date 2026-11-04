/** The jobs currently executing on this node, by id. */
export type InFlightCounter = {
	increment: (id: number | string) => void
	decrement: (id: number | string) => void
	count: () => number
	/** The ids of the jobs running now, for handing them back on a timed-out drain. */
	ids: () => Array<number | string>
}

/**
 * Create a process-local in-flight counter. One counter is created per worker
 * instance and shared across all recovery wrappers running in that worker. A
 * closure rather than a DB query: cheaper, and it counts only runs this process
 * actually has in its hands. A job id is counted once per running handler, so
 * a workflow and the task it runs never double up (the task is not tracked).
 */
export const createInFlightCounter = (): InFlightCounter => {
	const running = new Map<number | string, number>()
	return {
		count: () => [...running.values()].reduce((sum, n) => sum + n, 0),
		decrement: (id) => {
			const n = (running.get(id) ?? 0) - 1
			if (n > 0) {
				running.set(id, n)
			} else {
				running.delete(id)
			}
		},
		ids: () => [...running.keys()],
		increment: (id) => {
			running.set(id, (running.get(id) ?? 0) + 1)
		},
	}
}

// Registry so the recovery wrappers (registered at plugin config time) and the
// worker (created at runtime) can share the same counter without explicit wiring.
const registry = new Map<string, InFlightCounter>()

/** Register or retrieve the counter for `ownerId`. Creates one on first call. */
export const getOrCreateCounter = (ownerId: string): InFlightCounter => {
	const hit = registry.get(ownerId)
	if (hit) {
		return hit
	}
	const c = createInFlightCounter()
	registry.set(ownerId, c)
	return c
}

/** Remove the counter for `ownerId` (call on worker teardown to avoid leaks in tests). */
export const releaseCounter = (ownerId: string): void => {
	registry.delete(ownerId)
}
