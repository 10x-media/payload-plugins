import type { TaskConfig } from 'payload'
import type { SipgateCredentials, SipgateHistoryParams } from '../types'
import { buildSipgateRest } from '../utils/sipgate.rest'
import { syncCallHistory, syncCallHistoryOAuth } from '../utils/sipgateSyncHandlers'

export const SYNC_CALL_HISTORY_TASK = 'sipgateSyncCallHistory'
export const SYNC_CALL_HISTORY_TASK_OAUTH = 'sipgateSyncCallHistoryOAuth'

export type SyncCallHistoryTaskDeps = {
	callLogsSlug: string
	credentials: SipgateCredentials
}

export type SyncCallHistoryTaskOAuthDeps = {
	callLogsSlug: string
	sipgateUsersSlug: string
	credentials: SipgateCredentials
}

export const buildSyncCallHistoryTask = (deps: SyncCallHistoryTaskDeps): TaskConfig =>
	({
		// biome-ignore lint/suspicious/noExplicitAny: task slug is plugin-defined, not in the generated TaskType union
		slug: SYNC_CALL_HISTORY_TASK as any,
		retries: 2,
		inputSchema: [
			{ name: 'limit', type: 'number' },
			{ name: 'from', type: 'text' },
			{ name: 'to', type: 'text' },
		],
		handler: async ({ input, req }) => {
			const { limit, from, to } = input as { limit?: number; from?: string; to?: string }
			const params: Partial<SipgateHistoryParams> = {
				limit: limit ?? 100,
				...(from ? { from } : {}),
				...(to ? { to } : {}),
			}
			const rest = buildSipgateRest(deps.credentials)
			const result = await syncCallHistory({
				payload: req.payload,
				rest,
				callLogsSlug: deps.callLogsSlug,
				params,
			})
			return { output: { synced: result.synced, errors: result.errors } }
		},
	}) as TaskConfig

/**
 * Per-user OAuth2 variant. Iterates all connected sipgate users, fetches call
 * history with each user's own access token, and upserts into the call-logs
 * collection. Duplicate calls (e.g. group lines) are deduplicated by callId.
 */
export const buildSyncCallHistoryTaskOAuth = (deps: SyncCallHistoryTaskOAuthDeps): TaskConfig =>
	({
		slug: SYNC_CALL_HISTORY_TASK_OAUTH,
		retries: 2,
		inputSchema: [
			{ name: 'limit', type: 'number' },
			{ name: 'from', type: 'text' },
			{ name: 'to', type: 'text' },
		],
		handler: async ({ input, req }) => {
			const { limit, from, to } = input as { limit?: number; from?: string; to?: string }
			const params: Partial<SipgateHistoryParams> = {
				limit: limit ?? 100,
				...(from ? { from } : {}),
				...(to ? { to } : {}),
			}
			const result = await syncCallHistoryOAuth({
				payload: req.payload,
				credentials: deps.credentials,
				sipgateUsersSlug: deps.sipgateUsersSlug,
				callLogsSlug: deps.callLogsSlug,
				params,
			})
			return { output: { synced: result.synced, errors: result.errors } }
		},
	}) as TaskConfig
