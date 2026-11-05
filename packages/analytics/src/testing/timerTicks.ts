/** A count SQLite needs a few hundred milliseconds for: four million rows of a recursive CTE. */
export const LONG_COUNT_SQL =
	'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4000000) SELECT count(*) AS n FROM c'

/**
 * The latest a timer may fire while `ms` of work runs off this thread: load alone delays timers, so
 * the bound grows with the run; a thread held by the work would miss it by the whole run.
 */
export const stallBound = (ms: number): number => Math.max(250, ms / 4)

const TICK_MS = 5

/**
 * How a short timer fared while `work` ran: how often it fired, its worst gap (the one still open
 * when `work` settled included), and when it first fired.
 */
export const ticking = async <T>(work: () => Promise<T>) => {
	let ticks = 0
	let worstGapMs = 0
	let firstAt: number | undefined
	const started = performance.now()
	let last = started
	const timer = setInterval(() => {
		const at = performance.now()
		worstGapMs = Math.max(worstGapMs, at - last)
		last = at
		firstAt ??= at - started
		ticks += 1
	}, TICK_MS)
	try {
		const outcome = await work().then(
			(value) => ({ value, error: undefined }),
			(error: unknown) => ({ value: undefined, error })
		)
		const ms = performance.now() - started
		return {
			...outcome,
			ticks,
			worstGapMs: Math.max(worstGapMs, performance.now() - last),
			firstAt,
			ms,
		}
	} finally {
		clearInterval(timer)
	}
}
