/** A process-local counter for jobs currently executing on this node. */
export type InFlightCounter = {
	increment: () => void
	decrement: () => void
	count: () => number
}

/**
 * Create a process-local in-flight counter. One counter is created per worker
 * instance and shared across all heartbeat wrappers running in that worker.
 * Uses a simple closure rather than a DB query, which is cheaper and immune to
 * TOCTOU races on the `claimedBy` field between heartbeat renewals.
 */
export const createInFlightCounter = (): InFlightCounter => {
	let n = 0
	return {
		count: () => n,
		decrement: () => {
			n--
		},
		increment: () => {
			n++
		},
	}
}

// Registry so the heartbeat wrappers (registered at plugin config time) and the
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
