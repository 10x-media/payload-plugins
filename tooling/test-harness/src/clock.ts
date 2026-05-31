import { _internal_jobSystemGlobals, _internal_resetJobSystemGlobals } from 'payload'

/** A mutable, advanceable clock installed into Payload's job-system global. */
export interface TestClock {
	/** The current frozen instant. */
	now: () => Date
	/** Set the clock to an absolute instant. */
	set: (date: Date) => void
	/** Advance the clock by a delta in milliseconds. */
	advance: (ms: number) => void
	/** Restore Payload's real wall-clock. Call in afterEach/afterAll. */
	reset: () => void
}

/**
 * Freeze Payload's `getCurrentDate()` at `start` and return handles to advance it.
 * Every time-based decision in the jobs engine (and in this plugin) reads
 * `getCurrentDate()`, so tests control time with zero real waits. The plugin must
 * stamp every lease timestamp from `getCurrentDate()` for this to hold.
 */
export const installTestClock = (start = new Date('2026-01-01T00:00:00.000Z')): TestClock => {
	let current = new Date(start.getTime())
	_internal_jobSystemGlobals.getCurrentDate = () => new Date(current.getTime())
	return {
		now: () => new Date(current.getTime()),
		set: (date) => {
			current = new Date(date.getTime())
		},
		advance: (ms) => {
			current = new Date(current.getTime() + ms)
		},
		reset: () => _internal_resetJobSystemGlobals(),
	}
}
