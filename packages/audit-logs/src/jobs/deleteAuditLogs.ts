import type { TaskConfig, Where } from 'payload'

import type { DeleteJobHooks } from '../types'

export type DeleteTaskOptions = {
	cron: string
	queue: string
	hasArchive: boolean
	where?: Where
	hooks?: DeleteJobHooks
}

export const buildDeleteTask = (options: DeleteTaskOptions): TaskConfig => ({
	slug: 'audit-logs-delete',
	schedule: [{ cron: options.cron, queue: options.queue }],
	handler: async ({ req, job }) => {
		const baseWhere: Where = options.hasArchive ? { archivedAt: { exists: true } } : {}
		const where: Where = options.where
			? Object.keys(baseWhere).length
				? { and: [baseWhere, options.where] }
				: options.where
			: baseWhere

		let deleted = 0

		await options.hooks?.beforeRun?.({ req, job })

		// Always re-query page 1, after each batch is deleted, the next batch shifts up
		while (true) {
			const { docs } = await req.payload.find({
				collection: 'audit-logs',
				where,
				limit: 500,
				depth: 0,
				overrideAccess: true,
			})

			if (docs.length === 0) break

			for (const doc of docs) {
				await req.payload.delete({
					collection: 'audit-logs',
					id: doc.id,
					overrideAccess: true,
				})
				deleted++
			}

			await options.hooks?.afterBatch?.({
				req,
				job,
				docsInBatch: docs.length,
				totalDeleted: deleted,
			})
		}

		await options.hooks?.afterRun?.({ req, job, deleted })
		return { output: { deleted } }
	},
})
