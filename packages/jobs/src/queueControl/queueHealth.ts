import type { Payload, Where } from 'payload'

const JOBS_SLUG = 'payload-jobs'
const STATS_SLUG = 'payload-jobs-stats'

/** Per-queue health counts plus the last scheduled run. */
export type QueueHealth = {
	queue: string
	pending: number
	processing: number
	failed: number
	recovered: number
	lastScheduledRun: string | null
}

export type QueueHealthReport = {
	totals: { pending: number; processing: number; failed: number; recovered: number }
	oldestPendingAgeMs: number | null
	queues: QueueHealth[]
}

export type GetQueueHealthOptions = {
	/** Queues to break out per-queue. Default ['default']. */
	queues?: string[]
	/** Include the recovered count (requires the reliability `recoveryAttempts` field). */
	includeRecovered?: boolean
	/** Reference time for the oldest-pending age. Default now. */
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

const queueClause = (queue?: string): Where[] => (queue ? [{ queue: { equals: queue } }] : [])

const pendingWhere = (queue?: string): Where => ({
	and: [
		{ completedAt: { exists: false } },
		{ hasError: { not_equals: true } },
		{ processing: { equals: false } },
		...queueClause(queue),
	],
})
const processingWhere = (queue?: string): Where => ({
	and: [{ processing: { equals: true } }, ...queueClause(queue)],
})
const failedWhere = (queue?: string): Where => ({
	and: [{ hasError: { equals: true } }, ...queueClause(queue)],
})
const recoveredWhere = (queue?: string): Where => ({
	and: [{ recoveryAttempts: { greater_than: 0 } }, ...queueClause(queue)],
})

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
 * Aggregate queue health via `payload.count` per state (pending, processing, failed,
 * and, when reliability is on, recovered), plus the oldest-pending age and the last
 * scheduled run per queue. Reuses Payload's own run-selector predicates. The stats
 * global is read through `payload.db.findGlobal` inside a try/catch because that call
 * throws when the global does not exist (no schedule has run).
 */
export const getQueueHealth = async (
	payload: Payload,
	options: GetQueueHealthOptions = {}
): Promise<QueueHealthReport> => {
	const queues = options.queues ?? ['default']
	const includeRecovered = options.includeRecovered ?? false
	const count = payload.count as unknown as Counter
	const find = payload.find as unknown as Finder
	const countWhere = async (where: Where): Promise<number> =>
		(await count({ collection: JOBS_SLUG, where })).totalDocs

	const totals = {
		failed: await countWhere(failedWhere()),
		pending: await countWhere(pendingWhere()),
		processing: await countWhere(processingWhere()),
		recovered: includeRecovered ? await countWhere(recoveredWhere()) : 0,
	}

	const oldest = await find({
		collection: JOBS_SLUG,
		depth: 0,
		limit: 1,
		sort: 'createdAt',
		where: pendingWhere(),
	})
	const oldestCreated = oldest.docs[0]?.createdAt
	const nowMs = (options.now ?? new Date()).getTime()
	const oldestPendingAgeMs = oldestCreated ? nowMs - new Date(oldestCreated).getTime() : null

	const stats = await readStats(payload)
	const perQueue: QueueHealth[] = []
	for (const queue of queues) {
		perQueue.push({
			failed: await countWhere(failedWhere(queue)),
			lastScheduledRun: lastScheduledRunFor(stats, queue),
			pending: await countWhere(pendingWhere(queue)),
			processing: await countWhere(processingWhere(queue)),
			queue,
			recovered: includeRecovered ? await countWhere(recoveredWhere(queue)) : 0,
		})
	}

	return { oldestPendingAgeMs, queues: perQueue, totals }
}
