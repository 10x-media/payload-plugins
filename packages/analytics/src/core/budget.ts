/** What {@link withinBudget} answers when the time ran out first. */
export const OVER_BUDGET: unique symbol = Symbol('analytics/overBudget')

/**
 * Settles with `work`, or with {@link OVER_BUDGET} once `ms` pass. The work is not cancelled: it
 * runs on, and a failure after the budget is dropped rather than left unhandled.
 */
export const withinBudget = async <T>(
	work: Promise<T>,
	ms: number
): Promise<T | typeof OVER_BUDGET> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const elapsed = new Promise<typeof OVER_BUDGET>((resolve) => {
		timer = setTimeout(() => resolve(OVER_BUDGET), ms)
		timer.unref?.()
	})
	work.catch(() => {})
	try {
		return await Promise.race([work, elapsed])
	} finally {
		clearTimeout(timer)
	}
}
