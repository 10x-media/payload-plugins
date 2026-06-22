import type { Payload, Where } from 'payload'

import type { JobStatus } from '../jobs/deriveJobStatus'
import { statusWhere } from '../jobs/deriveJobStatus'

const JOBS_SLUG = 'payload-jobs'
const STATS_SLUG = 'payload-jobs-stats'

/** Per-queue health: the seven canonical job states plus the orthogonal recovered count. */
export type QueueHealth = {
	queue: string
	/** Jobs waiting to run (no prior attempts, no future schedule). */
	queued: number
	/** Jobs scheduled in the future (`waitUntil > now`). */
	scheduled: number
	/** Jobs being retried after at least one failure. */
	retrying: number
	/** Jobs currently executing. */
	processing: number
	/** Jobs that completed successfully. */
	succeeded: number
	/** Jobs that completed with an unrecoverable error. */
	failed: number
	/** Jobs cancelled by the application. */
	cancelled: number
	/**
	 * Jobs recovered at least once (`recoveryAttempts > 0`). Orthogonal to the seven states
	 * above: a recovered job may currently be retrying, succeeded, or failed. 0 unless
	 * reliability is enabled and `includeRecovered` is set.
	 */
	recovered: number
	lastScheduledRun: string | null
}

export type QueueHealthReport = {
	totals: {
		queued: number
		scheduled: number
		retrying: number
		processing: number
		succeeded: number
		failed: number
		cancelled: number
		recovered: number
	}
	oldestQueuedAgeMs: number | null
	queues: QueueHealth[]
}

export type GetQueueHealthOptions = {
	/** Queues to break out per-queue. Default ['default']. */
	queues?: string[]
	/** Include the recovered count (requires the reliability `recoveryAttempts` field). */
	includeRecovered?: boolean
	/** Reference time for age and scheduled comparisons. Default now. */
	now?: Date
}

// The dev app compiles this file with generated types lacking our custom fields, so
// reach the data layer through slug-agnostic signatures (same pattern as the sweeper).
type Counter = (args: { collection: string; where?: Where }) => Promise<{ totalDocs: number }>
type Finder = (args: {
	collection: string
	where?: Where
	limit?: number
	sort?: string
	depth?: number
}) => Promise<{ docs: Array<{ createdAt?: string }> }>
type GlobalReader = (args: { slug: string }) => Promise<unknown>

const queueFilter = (queue?: string): Where[] => (queue ? [{ queue: { equals: queue } }] : [])

const stateWhere = (status: JobStatus, now: number, queue?: string): Where => {
	const base = statusWhere(status, now)
	const extra = queueFilter(queue)
	if (extra.length === 0) {
		return base
	}
	return { and: [base, ...extra] }
}

/**
 * Jobs recovered at least once. Orthogonal to the seven mutually-exclusive states (a
 * recovered job may now be retrying, succeeded, or failed), so it is counted separately
 * via the reliability `recoveryAttempts` field rather than slotted into the partition.
 */
const recoveredWhere = (queue?: string): Where => {
	const base: Where = { recoveryAttempts: { greater_than: 0 } }
	const extra = queueFilter(queue)
	return extra.length === 0 ? base : { and: [base, ...extra] }
}

const readStats = async (payload: Payload): Promise<unknown> => {
	const db = payload.db as unknown as { findGlobal: GlobalReader }
	try {
		return await db.findGlobal({ slug: STATS_SLUG })
	} catch {
		return null
	}
}

type StatsShape = {
	stats?: {
		scheduledRuns?: {
			queues?: Record<
				string,
				{
					tasks?: Record<string, { lastScheduledRun?: string }>
					workflows?: Record<string, { lastScheduledRun?: string }>
				}
			>
		}
	}
}

const lastScheduledRunFor = (stats: unknown, queue: string): string | null => {
	const entry = (stats as StatsShape)?.stats?.scheduledRuns?.queues?.[queue]
	if (!entry) {
		return null
	}
	const runs = [...Object.values(entry.tasks ?? {}), ...Object.values(entry.workflows ?? {})]
		.map((r) => r.lastScheduledRun)
		.filter((r): r is string => typeof r === 'string')
	return runs.length > 0 ? (runs.sort().at(-1) ?? null) : null
}

/**
 * Aggregate queue health via `payload.count`: the seven canonical states
 * (queued, scheduled, retrying, processing, succeeded, failed, cancelled) plus an
 * orthogonal `recovered` count (recoveryAttempts > 0) when `includeRecovered` is set.
 * Reuses `statusWhere` from `deriveJobStatus` so the predicates are consistent
 * with what the UI and individual job reads report. The stats global is read
 * through `payload.db.findGlobal` inside a try/catch because that call throws
 * when the global does not exist (no schedule has run yet).
 */
export const getQueueHealth = async (
	payload: Payload,
	options: GetQueueHealthOptions = {}
): Promise<QueueHealthReport> => {
	const queues = options.queues ?? ['default']
	const includeRecovered = options.includeRecovered ?? false
	const nowMs = (options.now ?? new Date()).getTime()
	const count = payload.count as unknown as Counter
	const find = payload.find as unknown as Finder

	const countWhere = async (where: Where): Promise<number> =>
		(await count({ collection: JOBS_SLUG, where })).totalDocs

	const countState = (status: JobStatus, queue?: string): Promise<number> =>
		countWhere(stateWhere(status, nowMs, queue))

	const [queued, scheduled, retrying, processing, succeeded, failed, cancelled, recovered] =
		await Promise.all([
			countState('queued'),
			countState('scheduled'),
			countState('retrying'),
			countState('running'),
			countState('succeeded'),
			countState('failed'),
			countState('cancelled'),
			includeRecovered ? countWhere(recoveredWhere()) : Promise.resolve(0),
		])

	const oldest = await find({
		collection: JOBS_SLUG,
		depth: 0,
		limit: 1,
		sort: 'createdAt',
		where: statusWhere('queued', nowMs),
	})
	const oldestCreated = oldest.docs[0]?.createdAt
	const oldestQueuedAgeMs = oldestCreated ? nowMs - new Date(oldestCreated).getTime() : null

	const stats = await readStats(payload)
	const perQueue: QueueHealth[] = []
	for (const queue of queues) {
		const [
			queuedCount,
			scheduledCount,
			retryingCount,
			processingCount,
			succeededCount,
			failedCount,
			cancelledCount,
			recoveredCount,
		] = await Promise.all([
			countState('queued', queue),
			countState('scheduled', queue),
			countState('retrying', queue),
			countState('running', queue),
			countState('succeeded', queue),
			countState('failed', queue),
			countState('cancelled', queue),
			includeRecovered ? countWhere(recoveredWhere(queue)) : Promise.resolve(0),
		])
		perQueue.push({
			cancelled: cancelledCount,
			failed: failedCount,
			lastScheduledRun: lastScheduledRunFor(stats, queue),
			processing: processingCount,
			queue,
			queued: queuedCount,
			recovered: recoveredCount,
			retrying: retryingCount,
			scheduled: scheduledCount,
			succeeded: succeededCount,
		})
	}

	return {
		oldestQueuedAgeMs,
		queues: perQueue,
		totals: {
			cancelled,
			failed,
			processing,
			queued,
			recovered,
			retrying,
			scheduled,
			succeeded,
		},
	}
}
