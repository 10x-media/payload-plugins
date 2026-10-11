import type { CollectionSlug, Payload } from 'payload'

import { DEFAULT_DELIVERIES_SLUG } from '../constants'

const DAY_MS = 86_400_000
const PRUNE_INTERVAL_MS = 3_600_000

export type PruneDeliveriesOptions = {
	/** Finished deliveries created longer ago than this are deleted. */
	olderThanDays: number
	deliveriesSlug?: string
	now?: number
}

/**
 * Delete finished delivery rows older than a retention window.
 *
 * The log keeps the full body of every delivery, so left alone it grows with every write to a
 * watched collection. Only rows that are done are removed: a `pending` or `failed` row still has
 * an attempt ahead of it, however old it is.
 *
 * This goes through the adapter rather than the Local API. A bulk delete there loads and deletes
 * documents one at a time, which is the wrong shape for clearing a backlog, and the log has no
 * hooks worth running.
 */
export const pruneDeliveries = async (
	payload: Payload,
	options: PruneDeliveriesOptions
): Promise<void> => {
	// Zero or a negative window would delete every finished row, and a missing one is not a date.
	if (!Number.isFinite(options.olderThanDays) || options.olderThanDays <= 0) {
		throw new Error(
			`@10x-media/webhooks: pruneDeliveries needs a positive olderThanDays, got ${options.olderThanDays}.`
		)
	}
	const cutoff = new Date((options.now ?? Date.now()) - options.olderThanDays * DAY_MS)
	await payload.db.deleteMany({
		collection: (options.deliveriesSlug ?? DEFAULT_DELIVERIES_SLUG) as CollectionSlug,
		where: {
			and: [
				{ createdAt: { less_than: cutoff.toISOString() } },
				{ status: { in: ['success', 'dead'] } },
			],
		},
	})
}

/**
 * A prune the dispatcher can call after every event without it costing anything most of the time:
 * it runs at most once an hour per process, and never on the caller's time. No scheduler is
 * involved, so an install with no job runner still has its log trimmed. One that goes quiet for
 * longer than the window keeps its last rows until the next event; `pruneDeliveries` is exported
 * for a cron that wants it exact.
 */
export const makeThrottledPrune = (args: { deliveriesSlug: string; retentionDays: number }) => {
	let lastRun = 0
	return (payload: Payload): void => {
		const now = Date.now()
		if (now - lastRun < PRUNE_INTERVAL_MS) {
			return
		}
		lastRun = now
		void pruneDeliveries(payload, {
			deliveriesSlug: args.deliveriesSlug,
			now,
			olderThanDays: args.retentionDays,
		}).catch((err: unknown) => {
			payload.logger.error(
				`@10x-media/webhooks: pruning the delivery log failed: ${err instanceof Error ? err.message : String(err)}`
			)
		})
	}
}
