import type { TaskConfig } from 'payload'
import type { WildixCredentials } from '../types'
import { syncCallHistoryOAuth, syncCallHistoryPbx } from '../utils/wildixSyncHandlers'

export const SYNC_CALL_HISTORY_TASK = 'wildixSyncCallHistory'
export const SYNC_CALL_HISTORY_TASK_OAUTH = 'wildixSyncCallHistoryOAuth'

export type SyncCallHistoryTaskDeps = {
	callLogsSlug: string
	wildixUsersSlug: string
	credentials: WildixCredentials
}

export type SyncCallHistoryTaskOAuthDeps = {
	callLogsSlug: string
	wildixUsersSlug: string
	credentials: WildixCredentials
}

export const buildSyncCallHistoryTask = (deps: SyncCallHistoryTaskDeps): TaskConfig =>
	({
		// biome-ignore lint/suspicious/noExplicitAny: task slug is plugin-defined, not in the generated TaskType union
		slug: SYNC_CALL_HISTORY_TASK as any,
		retries: 2,
		inputSchema: [{ name: 'limit', type: 'number' }],
		handler: async ({ input, req }) => {
			const { limit } = input as { limit?: number }
			const result = await syncCallHistoryPbx({
				payload: req.payload,
				credentials: deps.credentials,
				wildixUsersSlug: deps.wildixUsersSlug,
				callLogsSlug: deps.callLogsSlug,
				limit: limit ?? 100,
			})
			return { output: { synced: result.synced, errors: result.errors } }
		},
	}) as TaskConfig

/**
 * Per-user OAuth2 variant. Iterates all connected Wildix users, queries call
 * history with each user's own refreshing token, and upserts into call-logs.
 */
export const buildSyncCallHistoryTaskOAuth = (deps: SyncCallHistoryTaskOAuthDeps): TaskConfig =>
	({
		slug: SYNC_CALL_HISTORY_TASK_OAUTH,
		retries: 2,
		inputSchema: [{ name: 'limit', type: 'number' }],
		handler: async ({ input, req }) => {
			const { limit } = input as { limit?: number }
			const result = await syncCallHistoryOAuth({
				payload: req.payload,
				credentials: deps.credentials,
				wildixUsersSlug: deps.wildixUsersSlug,
				callLogsSlug: deps.callLogsSlug,
				limit: limit ?? 100,
			})
			return { output: { synced: result.synced, errors: result.errors } }
		},
	}) as TaskConfig
