/** How often a failure that repeats on every read is logged: once a minute. */
export const WARN_EVERY_MS = 60_000

/**
 * `say` limited to once per `intervalMs` on the `now` clock, so a failure repeating on every read
 * logs one line per interval rather than one per read.
 */
export const throttled = (
	say: (message: string) => void,
	clock: { now: () => number; intervalMs: number }
): ((message: string) => void) => {
	let saidAt: number | undefined
	return (message) => {
		const at = clock.now()
		if (saidAt !== undefined && at - saidAt < clock.intervalMs) {
			return
		}
		saidAt = at
		say(message)
	}
}
