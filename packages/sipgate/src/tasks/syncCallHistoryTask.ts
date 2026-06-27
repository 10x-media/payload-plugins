import type { TaskConfig } from 'payload'
import type {
	CallStatus,
	NeoCallEvent,
	SipgateCredentials,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { createOrUpdateCallLog } from '../utils/callLog'
import { buildSipgateRest, getCallHistory } from '../utils/sipgate.rest'

export const SYNC_CALL_HISTORY_TASK = 'sipgateSyncCallHistory'

export type SyncCallHistoryTaskDeps = {
	callLogsSlug: string
	credentials: SipgateCredentials
}

type NormalizedCallLog = {
	callId: string
	callType: 'in' | 'out'
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt: Date
}

const CLASSIC_DIRECTION_MAP: Record<string, 'in' | 'out'> = {
	INCOMING: 'in',
	OUTGOING: 'out',
	MISSED_INCOMING: 'in',
	MISSED_OUTGOING: 'out',
}

const CLASSIC_DIRECTION_MISSED = new Set(['MISSED_INCOMING', 'MISSED_OUTGOING'])

const CLASSIC_STATUS_MAP: Record<string, CallStatus> = {
	PICKUP: 'completed',
	NOPICKUP: 'missed',
	VOICEMAIL: 'voicemail',
	MISSED: 'missed',
	BUSY: 'missed',
	REJECTED: 'rejected',
	FAILED: 'missed',
}

const NEO_DIRECTION_MAP: Record<string, 'in' | 'out'> = {
	INCOMING: 'in',
	OUTGOING: 'out',
}

const NEO_STATE_MAP: Record<string, CallStatus> = {
	RINGING: 'ringing',
	ESTABLISHED: 'connected',
	FINISHED: 'completed',
	MISSED: 'missed',
	REJECTED: 'rejected',
	TRANSFERRING: 'connected',
	TRANSFERRED: 'completed',
	TRANSFER_FAILED: 'missed',
	BUSY: 'missed',
	CLIENT_ERROR: 'missed',
	UNKNOWN: 'completed',
}

function normalizeClassicItem(item: SipgateHistoryResponse['items'][0]): NormalizedCallLog | null {
	const direction = item.direction?.toUpperCase()
	const callType = CLASSIC_DIRECTION_MAP[direction]
	if (!callType) return null

	const callStatus = CLASSIC_DIRECTION_MISSED.has(direction)
		? 'missed'
		: (CLASSIC_STATUS_MAP[item.status?.toUpperCase()] ?? 'completed')

	return {
		callId: item.id,
		callType,
		callStatus,
		callDuration: 0,
		fromNumber: item.source,
		toNumber: item.target,
		startedAt: new Date(item.created),
	}
}

function normalizeNeoEvent(event: NeoCallEvent): NormalizedCallLog | null {
	const callType = NEO_DIRECTION_MAP[event.call.direction]
	if (!callType) return null

	const callStatus =
		event.call.terminatedReason === 'CANCELLED'
			? 'missed'
			: (NEO_STATE_MAP[event.call.state] ?? 'completed')

	let callDuration = 0
	if (event.call.establishedAt && event.call.terminatedAt) {
		callDuration = Math.max(
			0,
			Math.round(
				(new Date(event.call.terminatedAt).getTime() -
					new Date(event.call.establishedAt).getTime()) /
					1000
			)
		)
	}

	return {
		callId: event.call.callSid,
		callType,
		callStatus,
		callDuration,
		fromNumber: event.call.from,
		toNumber: event.call.to,
		startedAt: new Date(event.call.startedAt),
	}
}

function normalizeHistory(
	history: Awaited<ReturnType<typeof getCallHistory>>
): NormalizedCallLog[] {
	if (Array.isArray(history)) {
		return history.flatMap((event) => {
			const normalized = normalizeNeoEvent(event as NeoCallEvent)
			return normalized ? [normalized] : []
		})
	}
	return (history as SipgateHistoryResponse).items.flatMap((item) => {
		const normalized = normalizeClassicItem(item)
		return normalized ? [normalized] : []
	})
}

export const buildSyncCallHistoryTask = (deps: SyncCallHistoryTaskDeps): TaskConfig =>
	({
		slug: SYNC_CALL_HISTORY_TASK,
		retries: 2,
		inputSchema: [
			{ name: 'limit', type: 'number' },
			{ name: 'from', type: 'text' },
			{ name: 'to', type: 'text' },
		],
		handler: async ({ input, req }) => {
			const { payload } = req
			const { limit, from, to } = input as { limit?: number; from?: string; to?: string }

			const params: SipgateHistoryParams = {
				types: ['CALL'],
				limit: limit ?? 100,
				...(from ? { from } : {}),
				...(to ? { to } : {}),
			}

			const rest = buildSipgateRest(deps.credentials)
			const history = await getCallHistory(rest, params)
			const entries = normalizeHistory(history)

			let created = 0
			let updated = 0

			for (const entry of entries) {
				const result = await createOrUpdateCallLog(payload, deps.callLogsSlug, entry)
				if ('createdAt' in result && result.createdAt === result.updatedAt) {
					created++
				} else {
					updated++
				}
			}

			return { output: { created, updated, total: entries.length } }
		},
	}) as TaskConfig
