import type { Config, TaskConfig } from 'payload'

import { closeStaleImpersonations } from '../session/closeStale'
import type { ResolvedOptions } from '../types'

const DEFAULT_CRON = '0 3 * * *'
const DEFAULT_QUEUE = 'impersonation-retention'
const PAGE = 100

/**
 * Opt-in job: close stale open rows, then delete closed rows older than
 * `deleteAfterDays`. The host must run the queue.
 */
export const registerRetention = (config: Config, options: ResolvedOptions): void => {
	const retention = options.retention
	if (!retention) {
		return
	}

	const task = {
		slug: 'impersonationRetention',
		schedule: [{ cron: retention.cron ?? DEFAULT_CRON, queue: retention.queue ?? DEFAULT_QUEUE }],
		handler: async ({ req }) => {
			const closed = await closeStaleImpersonations(req.payload)
			const cutoff = new Date(Date.now() - retention.deleteAfterDays * 86_400_000).toISOString()
			let deleted = 0
			for (;;) {
				const { docs } = await req.payload.find({
					collection: options.collectionSlug,
					depth: 0,
					limit: PAGE,
					overrideAccess: true,
					pagination: false,
					where: {
						and: [{ endedAt: { exists: true } }, { endedAt: { less_than_equal: cutoff } }],
					},
				})
				if (docs.length === 0) {
					break
				}
				for (const doc of docs) {
					await req.payload.delete({
						collection: options.collectionSlug,
						id: doc.id,
						overrideAccess: true,
					})
					deleted += 1
				}
				if (docs.length < PAGE) {
					break
				}
			}
			return { output: { closed, deleted } }
		},
	} as TaskConfig

	config.jobs = {
		...config.jobs,
		tasks: [...(config.jobs?.tasks ?? []), task],
	}
}
