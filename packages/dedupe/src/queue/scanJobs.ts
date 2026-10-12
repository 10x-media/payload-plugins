import type { PayloadRequest, Where } from 'payload'

import type { CollectionContext, PluginContext } from '../plugin/context'

/** Payload's jobs collection, which the root package does not export a constant for. */
const JOBS_SLUG = 'payload-jobs'

export const SCAN_TASK_SLUG = 'dedupe-scan'

/** The concurrency key of one collection's scan: two never run at once, on any server. */
export const scanKey = (collection: string): string => `${SCAN_TASK_SLUG}:${collection}`

export type PendingScan = { jobId: string; running: boolean }

type JobRow = {
	id: number | string
	input?: { collection?: unknown } | null
	processing?: boolean | null
}

/**
 * The scans waiting or running, by collection, as Payload counts a job runnable: not
 * completed and without a final error. Found by concurrency key, which Payload adds and
 * indexes only with `jobs.enableConcurrencyControl`; without it, among every pending scan by
 * the input it was queued with, of which there are a handful at most.
 */
export const pendingScans = async (args: {
	req: PayloadRequest
	collections: string[]
}): Promise<Map<string, PendingScan>> => {
	const { req, collections } = args
	const pending = new Map<string, PendingScan>()
	if (collections.length === 0) return pending
	const keyed = req.payload.config.jobs?.enableConcurrencyControl === true
	const where: Where = {
		and: [
			{ completedAt: { exists: false } },
			{ error: { exists: false } },
			keyed
				? { concurrencyKey: { in: collections.map(scanKey) } }
				: { taskSlug: { equals: SCAN_TASK_SLUG } },
		],
	}
	const { docs } = await req.payload.db.find<JobRow>({
		collection: JOBS_SLUG,
		where,
		limit: 0,
		pagination: false,
		req,
	})
	for (const job of docs) {
		const collection = job.input?.collection
		if (typeof collection !== 'string' || !collections.includes(collection)) continue
		const running = job.processing === true
		const known = pending.get(collection)
		if (!known || (running && !known.running)) {
			pending.set(collection, { jobId: String(job.id), running })
		}
	}
	return pending
}

export type QueuedScan = { collection: string; jobId: string; alreadyQueued: boolean }

/**
 * Queues a scan of each collection on the scan queue, unless one is already waiting or
 * running, whose job is answered instead. A scan of every collection is one per collection,
 * so it covers a pending scan of one, and a later scan of one finds it pending.
 */
export const queueScans = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	cols: CollectionContext[]
}): Promise<QueuedScan[]> => {
	const { req, ctx, cols } = args
	const pending = await pendingScans({ req, collections: cols.map((col) => col.slug) })
	const queued: QueuedScan[] = []
	for (const col of cols) {
		const known = pending.get(col.slug)
		if (known) {
			queued.push({ collection: col.slug, jobId: known.jobId, alreadyQueued: true })
			continue
		}
		const job = (await req.payload.jobs.queue({
			task: SCAN_TASK_SLUG as never,
			input: { collection: col.slug } as never,
			queue: ctx.options.scanQueue,
		})) as { id: number | string }
		queued.push({ collection: col.slug, jobId: String(job.id), alreadyQueued: false })
	}
	return queued
}
