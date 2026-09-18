import type { TaskConfig } from 'payload'
import { EVENTS_SLUG } from '../collections/events'
import { ROLLUPS_SLUG } from '../collections/rollups'
import { SEEN_SLUG } from '../collections/seen'
import { saltKey } from '../ingest/salt'

export const PRUNE_TASK_SLUG = 'analytics-prune-events'

const DAY_MS = 86_400_000

/**
 * An event arriving just before midnight is still hashed with yesterday's salt, so the sweep
 * starts two days back. It ends at 62 because keys are deleted by computed name rather than by
 * listing them, and that covers every day a nightly run could have missed.
 */
const SALT_SWEEP_FIRST_DAY = 2
const SALT_SWEEP_LAST_DAY = 62

export interface PruneOptions {
	/** Events and seen-ledger rows older than this many days go. Unset keeps them. */
	retentionDays?: number
	/** Rollup rows whose period is older than this many days go. Unset keeps them. */
	rollupRetentionDays?: number
	/** The clock the run reads. Defaults to `Date.now`, and exists so a test can pin an instant. */
	now?: () => number
}

/**
 * A window prunes only when it is a finite number of days above zero. Zero means "keep
 * everything" wherever these windows are configured, so a window that does not say how far
 * back to go must never be read here as a cutoff of now, which would delete the whole store.
 */
const pruneWindow = (days: number | undefined): number | undefined =>
	days !== undefined && Number.isFinite(days) && days > 0 ? days : undefined

/**
 * The nightly sweep of everything the native engine stores. It registers only on an install
 * that configured a retention window, and sweeps the daily salts whenever it runs; an install
 * without one sweeps its salts at ingest instead, so no install needs a jobs runner for that.
 *
 * A window that is not a finite number of days above zero leaves its store untouched, for both
 * `retentionDays` and `rollupRetentionDays`.
 *
 * Deletes go through the database adapter's bulk delete, so no document is loaded to be
 * deleted and nothing is reported that would cost a read to count. That bypasses collection
 * hooks and access control, neither of which these three stores rely on.
 */
export const pruneEventsTask = (
	options: PruneOptions = {}
): TaskConfig<{ input: Record<string, never>; output: Record<string, never> }> => ({
	slug: PRUNE_TASK_SLUG,
	handler: async ({ req }) => {
		const now = (options.now ?? Date.now)()
		const cutoff = (days: number): string => new Date(now - days * DAY_MS).toISOString()
		const retentionDays = pruneWindow(options.retentionDays)
		const rollupRetentionDays = pruneWindow(options.rollupRetentionDays)
		if (retentionDays !== undefined) {
			const before = cutoff(retentionDays)
			await req.payload.db.deleteMany({
				collection: EVENTS_SLUG,
				where: { timestamp: { less_than: before } },
				req,
			})
			await req.payload.db.deleteMany({
				collection: SEEN_SLUG,
				where: { period: { less_than: before } },
				req,
			})
		}
		if (rollupRetentionDays !== undefined) {
			await req.payload.db.deleteMany({
				collection: ROLLUPS_SLUG,
				where: { period: { less_than: cutoff(rollupRetentionDays) } },
				req,
			})
		}
		for (let day = SALT_SWEEP_FIRST_DAY; day <= SALT_SWEEP_LAST_DAY; day++) {
			await req.payload.kv.delete(saltKey(new Date(now - day * DAY_MS)))
		}
		return { output: {} }
	},
	schedule: [{ cron: '0 3 * * *', queue: 'default' }],
})
