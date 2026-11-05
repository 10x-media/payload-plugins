import type { Payload } from 'payload'
import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'

/**
 * Where an answered read came from: this instance's memory, a fresh entry of the cache store, an
 * expired entry served while it refreshes (`meta.stale`), or the source itself just now.
 */
export type ReadOrigin = 'memory' | 'store' | 'stale' | 'source'

export interface AfterReadArgs {
	/** The id of the source that answered. */
	adapterId: string
	/**
	 * The query as the engine read it: clamped to the source's lookback, with the scope, timezone and
	 * goal slugs the surface resolved. Weeks and months are as asked, not the days they were read as.
	 */
	query: AnalyticsQuery
	/**
	 * The answer, already shaped (ranked, cut to `limit`) and cached. Other readers share this very
	 * object, so the hook never changes it: it returns a new one to answer differently.
	 */
	result: AnalyticsResult
	from: ReadOrigin
	/** Milliseconds from the start of the read to its answer, every wait included. */
	durationMs: number
	payload: Payload
}

/** What `hooks.afterRead` answers with: a new result for this one read, or nothing to keep it. */
// biome-ignore lint/suspicious/noConfusingVoidType: a block-bodied observing hook returns void
export type AfterReadAnswer = AnalyticsResult | undefined | void

/**
 * `hooks.afterRead`: runs for every read answered to a reader, once cached; its return answers that
 * one read uncached. Awaited, so a slow hook slows every read; a throw is logged and ignored.
 */
export type AfterReadHook = (args: AfterReadArgs) => AfterReadAnswer | Promise<AfterReadAnswer>
