import type { TaskConfig } from 'payload'
import { EVENTS_SLUG } from '../collections/events'
import { SEEN_SLUG } from '../collections/seen'

export const PRUNE_TASK_SLUG = 'analytics-prune-events'

export const pruneEventsTask = (
	retentionDays: number
): TaskConfig<{ input: Record<string, never>; output: { deleted: number } }> => ({
	slug: PRUNE_TASK_SLUG,
	handler: async ({ req }) => {
		const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString()
		const events = await req.payload.delete({
			collection: EVENTS_SLUG as never,
			where: { timestamp: { less_than: cutoff } },
			overrideAccess: true,
		})
		const seen = await req.payload.delete({
			collection: SEEN_SLUG as never,
			where: { period: { less_than: cutoff } },
			overrideAccess: true,
		})
		return { output: { deleted: events.docs.length + seen.docs.length } }
	},
	schedule: [{ cron: '0 3 * * *', queue: 'default' }],
})
