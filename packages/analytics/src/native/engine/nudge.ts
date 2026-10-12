/** How often one instance's ingest may start maintenance. */
export const NUDGE_EVERY_MS = 10 * 60_000

/** How long a run ingest starts may work: short, since it runs beside the requests. */
export const NUDGE_BUDGET_MS = 2_000

interface Nudger {
	/** Starts the work unless it ran within the window or still runs; never waits for it. */
	nudge(): void
}

/**
 * Starts `start` at most once per `everyMs` by `now`, and never while the previous start still
 * runs, however long it takes. `start` answers the work it began, which must not reject.
 */
export const createNudger = (args: {
	now: () => number
	everyMs: number
	start: () => Promise<void>
}): Nudger => {
	let last: number | null = null
	let running = false
	return {
		nudge() {
			const at = args.now()
			if (running || (last !== null && at - last < args.everyMs)) {
				return
			}
			last = at
			running = true
			void args.start().finally(() => {
				running = false
			})
		},
	}
}
