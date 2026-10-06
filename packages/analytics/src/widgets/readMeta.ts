import type { AnalyticsResult } from '../core/contract'

/** The state flags every widget result carries, whatever shape its numbers take. */
export interface WidgetReadMeta {
	/** The source read a shorter window than the one that was asked for. */
	clamped: boolean
	/** The engine served an expired cache entry after a failed provider read. */
	stale: boolean
	/** The source answered without one of the filters the read carried. */
	filtersUnapplied: boolean
	/** The source could not read the scope's goals, so the goal numbers mean nothing. */
	goalsUnresolved: boolean
	/** The read hit the source's event scan cap, so the numbers are a floor. */
	sampled: boolean
	/** The source that answered. */
	provider: string
}

/**
 * One mapping from an adapter result's meta to the flags a widget renders. Every helper
 * maps all of them, so a widget that starts rendering a notice needs nothing from the read
 * path, and a flag cannot go missing on one widget while its neighbour shows it.
 */
export const readMeta = (result: AnalyticsResult): WidgetReadMeta => ({
	clamped: result.meta.clamped ?? false,
	stale: result.meta.stale ?? false,
	filtersUnapplied: (result.meta.unappliedFilters?.length ?? 0) > 0,
	goalsUnresolved: result.meta.goalsUnresolved === true,
	sampled: result.meta.sampled ?? false,
	provider: result.meta.provider,
})
