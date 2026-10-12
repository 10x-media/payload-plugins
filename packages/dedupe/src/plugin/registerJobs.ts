import type { Config, TaskConfig } from 'payload'
import { isLive, loadDoc } from '../merge/load'
import type { ResolvedOptions } from '../options'
import { checkDocument } from '../queue/live'
import { runScan } from '../queue/scan'
import { queueScans, SCAN_TASK_SLUG, scanKey } from '../queue/scanJobs'
import { getCollectionContext, getContext } from './context'

export { SCAN_TASK_SLUG }
export const CHECK_TASK_SLUG = 'dedupe-check'

/**
 * The check on save and the scan as jobs. The check is queued by every save of a matched
 * collection. A scan job scans one collection; without a `collection` input, which is what the
 * cron schedule queues, it queues one for each matched collection that has none pending. Running the queue is the host's business through
 * `jobs.autoRun`, a cron hitting the run endpoint, or `payload.jobs.run`. Under
 * `disableJobsQueue` both run in the request, and only a schedule still needs the scan task
 * and the jobs collection it adds to the host's schema.
 *
 * Payload refuses to boot with a concurrency key while `jobs.enableConcurrencyControl` is
 * off, so the keys are set only when the host turned it on.
 */
export const registerJobs = (config: Config, options: ResolvedOptions): void => {
	const matched = options.collections.filter((entry) => entry.match)
	if (matched.length === 0) return
	const concurrency = config.jobs?.enableConcurrencyControl === true
	const tasks: TaskConfig[] = []

	if (!options.disableJobsQueue && matched.some((entry) => entry.checkOnSave)) {
		tasks.push({
			slug: CHECK_TASK_SLUG,
			retries: 2,
			// One check per collection at a time, so two look-alikes saved together do not both
			// create the pair between them.
			...(concurrency
				? {
						concurrency: ({ input }: { input?: { collection?: unknown } }) =>
							`${CHECK_TASK_SLUG}:${String(input?.collection)}`,
					}
				: {}),
			inputSchema: [
				{ name: 'collection', type: 'text', required: true },
				{ name: 'id', type: 'text', required: true },
			],
			handler: async ({ input, req }) => {
				const { collection, id } = input as { collection: string; id: string }
				const ctx = getContext(req.payload)
				const col = ctx.collections.get(collection)
				if (!col?.options.match) return { output: {} }
				// Trashed or taken off publication since the save queued it: that change handled it.
				const doc = await loadDoc({ req, ctx, col, id })
				if (!doc || !isLive(col, doc)) return { output: {} }
				await checkDocument({ req, ctx, col, doc })
				return { output: {} }
			},
		})
	}

	if (!options.disableJobsQueue || options.scanCron) {
		tasks.push({
			slug: SCAN_TASK_SLUG,
			retries: 0,
			// One scan of a collection at a time across servers; without the control, the
			// per-instance lock in `runScan` is what holds.
			...(concurrency
				? {
						concurrency: ({ input }: { input?: { collection?: unknown } }) =>
							typeof input?.collection === 'string' ? scanKey(input.collection) : SCAN_TASK_SLUG,
					}
				: {}),
			inputSchema: [{ name: 'collection', type: 'text' }],
			outputSchema: [{ name: 'summaries', type: 'json' }],
			...(options.scanCron
				? { schedule: [{ cron: options.scanCron, queue: options.scanQueue }] }
				: {}),
			handler: async ({ input, req }) => {
				const { collection } = (input ?? {}) as { collection?: string }
				const ctx = getContext(req.payload)
				if (!collection) {
					const cols = [...ctx.collections.values()].filter((col) => col.options.match)
					await queueScans({ req, ctx, cols })
					return { output: { summaries: [] } }
				}
				const summary = await runScan({
					req,
					ctx,
					col: getCollectionContext(req.payload, collection),
				})
				return { output: { summaries: [summary] } }
			},
		})
	}

	if (tasks.length === 0) return
	config.jobs = {
		...config.jobs,
		tasks: [...(config.jobs?.tasks ?? []), ...tasks],
	}
}
