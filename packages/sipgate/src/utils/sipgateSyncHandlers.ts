import type { CollectionSlug, Payload } from 'payload'
import type {
	CallStatus,
	NeoCallEvent,
	SipgateCredentials,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { createOrUpdateCallLog } from './callLog'
import {
	buildSipgateRest,
	getCallHistory,
	getDevices,
	getGroups,
	getUsers,
	type SipgateDevice,
	type SipgateRestFetch,
} from './sipgate.rest'
import { buildSipgateRestOAuth } from './sipgateOAuthRest'
import { upsertByField } from './upsertByField'

export type SyncResult = { synced: number; errors: number; deleted: number }

type SyncUsersOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateUsersSlug: string
	prune?: boolean
}

export const syncUsers = async ({
	payload,
	rest,
	sipgateUsersSlug,
	prune,
}: SyncUsersOptions): Promise<SyncResult> => {
	const users = await getUsers(rest)
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const user of users) {
		seenIds.add(user.id)
		try {
			await upsertByField({
				payload,
				collection: sipgateUsersSlug as CollectionSlug,
				uniqueField: 'sipgateId',
				uniqueValue: user.id,
				data: {
					sipgateId: user.id,
					firstname: user.firstname,
					lastname: user.lastname,
					email: user.email,
					defaultDevice: user.defaultDevice,
					admin: user.admin,
					busyOnBusy: user.busyOnBusy,
					timezone: user.timezone,
					addressId: user.addressId,
				},
			})
			synced++
		} catch {
			errors++
		}
	}

	if (prune) {
		try {
			const orphans = await payload.find({
				collection: sipgateUsersSlug as CollectionSlug,
				where: { id: { not_in: [...seenIds] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					await payload.delete({
						collection: sipgateUsersSlug as CollectionSlug,
						id: doc.id,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
}

type SyncDevicesOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateDevicesSlug: string
	sipgateUsersSlug: string
	prune?: boolean
	/**
	 * When set, only syncs devices for this specific sipgate user ID (the Payload
	 * document ID / sipgate user ID like "w0"). Prune is automatically disabled
	 * when scoping to a single user.
	 */
	scopeToUserId?: string
}

export const syncDevices = async ({
	payload,
	rest,
	sipgateDevicesSlug,
	sipgateUsersSlug,
	prune,
	scopeToUserId,
}: SyncDevicesOptions): Promise<SyncResult> => {
	const usersResult = await payload.find({
		collection: sipgateUsersSlug as CollectionSlug,
		where: scopeToUserId ? { sipgateId: { equals: scopeToUserId } } : undefined,
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	const seen = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const _user of usersResult.docs) {
		const user = _user as unknown as Record<string, unknown>
		const userId = user.sipgateId as string | undefined
		const payloadDocId = user.id as string
		if (!userId) {
			errors++
			continue
		}
		let userDevices: SipgateDevice[]
		try {
			userDevices = await getDevices(rest, userId)
		} catch {
			errors++
			continue
		}

		for (const device of userDevices) {
			if (seen.has(device.id)) continue
			seen.add(device.id)
			try {
				await upsertByField({
					payload,
					collection: sipgateDevicesSlug as CollectionSlug,
					uniqueField: 'sipgateId',
					uniqueValue: device.id,
					data: {
						sipgateId: device.id,
						alias: device.alias,
						type: device.type,
						online: device.online,
						dnd: device.dnd,
						activeGroups: device.activeGroups ?? [],
						activePhonelines: device.activePhonelines ?? [],
						sipgateUserId: userId,
						sipgateUser: payloadDocId,
					},
				})
				synced++
			} catch {
				errors++
			}
		}
	}

	if (prune && !scopeToUserId) {
		try {
			const orphans = await payload.find({
				collection: sipgateDevicesSlug as CollectionSlug,
				where: { id: { not_in: [...seen] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					await payload.delete({
						collection: sipgateDevicesSlug as CollectionSlug,
						id: doc.id,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
}

type SyncChannelsOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateChannelsSlug: string
	sipgateUsersSlug: string
	prune?: boolean
	/**
	 * When set, disables the global prune step so other users' channels are not
	 * deleted. The API already scopes channels by the OAuth token, so no
	 * application-level filtering is needed.
	 */
	scopeToUserId?: string
}

export const syncChannels = async ({
	payload,
	rest,
	sipgateChannelsSlug,
	sipgateUsersSlug,
	prune,
	scopeToUserId,
}: SyncChannelsOptions): Promise<SyncResult> => {
	const allGroups = await getGroups(rest)
	// When scoped, only sync channels this user is actually a member of.
	const groups = scopeToUserId
		? allGroups.filter((g) => g.users.some((u: { id: string }) => u.id === scopeToUserId))
		: allGroups
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const group of groups) {
		seenIds.add(group.id)
		try {
			const assignedUsers = await Promise.all(
				group.users.map(async (u) => {
					const result = await payload.find({
						collection: sipgateUsersSlug as CollectionSlug,
						where: { sipgateId: { equals: u.id } },
						limit: 1,
						overrideAccess: true,
					})
					const payloadDoc = result.docs[0]
					return {
						sipgateUserId: u.id,
						user: payloadDoc ? payloadDoc.id : undefined,
						deviceIds: u.deviceIds.map((deviceId: string) => ({ deviceId })),
					}
				})
			)

			await upsertByField({
				payload,
				collection: sipgateChannelsSlug as CollectionSlug,
				uniqueField: 'sipgateId',
				uniqueValue: group.id,
				data: {
					sipgateId: group.id,
					name: group.name,
					owner: group.owner,
					createdAt: group.createdAt ? new Date(group.createdAt) : undefined,
					locale: group.locale,
					assignedUsers,
					settings: {
						greetingAudioFileId: group.settings.greetingAudioFileId,
						smsSim: group.settings.smsSim,
						voiceboxAccessNumber: group.settings.voiceboxAccessNumber,
						queue: group.settings.queue
							? {
									respectWaitingTime: group.settings.queue.respectWaitingTime,
									waitingAudioFileId: group.settings.queue.waitingAudioFileId,
								}
							: undefined,
						ringingOrder: group.settings.ringingOrder
							? {
									type: group.settings.ringingOrder.type,
									users: (group.settings.ringingOrder.users ?? []).map((userId: string) => ({
										userId,
									})),
								}
							: undefined,
						userDefaults: group.settings.users
							? {
									followUpTime: group.settings.users.followUpTime,
									ringTime: group.settings.users.ringTime,
								}
							: undefined,
					},
				},
			})

			const isPersonalChannel = group.users.length === 1 && group.users[0]?.id === group.owner
			if (isPersonalChannel) {
				await upsertByField({
					payload,
					collection: sipgateUsersSlug as CollectionSlug,
					uniqueField: 'sipgateId',
					uniqueValue: group.owner,
					data: { defaultChannel: group.id },
				})
			}

			synced++
		} catch {
			errors++
		}
	}

	if (prune && !scopeToUserId) {
		try {
			const orphans = await payload.find({
				collection: sipgateChannelsSlug as CollectionSlug,
				where: { id: { not_in: [...seenIds] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					await payload.delete({
						collection: sipgateChannelsSlug as CollectionSlug,
						id: doc.id as string,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
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

type NormalizedCallLog = {
	callId: string
	callType: 'in' | 'out'
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt: Date
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

export function normalizeCallHistory(
	history: SipgateHistoryResponse | NeoCallEvent[]
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

type SyncCallHistoryOptions = {
	payload: Payload
	rest: SipgateRestFetch
	callLogsSlug: string
	params?: Partial<SipgateHistoryParams>
	/** Sipgate user ID to tag each log with. Used in OAuth2 mode. */
	sipgateUserId?: string
}

export const syncCallHistory = async ({
	payload,
	rest,
	callLogsSlug,
	params,
	sipgateUserId,
}: SyncCallHistoryOptions): Promise<SyncResult> => {
	const history = await getCallHistory(rest, {
		types: ['CALL'],
		limit: 100,
		...params,
	})
	const entries = normalizeCallHistory(history)
	let synced = 0
	let errors = 0

	for (const entry of entries) {
		try {
			await createOrUpdateCallLog(payload, callLogsSlug, {
				...entry,
				...(sipgateUserId ? { sipgateUserId } : {}),
			})
			synced++
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted: 0 }
}

type SyncCallHistoryOAuthOptions = {
	payload: Payload
	credentials: SipgateCredentials
	sipgateUsersSlug: string
	callLogsSlug: string
	params?: Partial<SipgateHistoryParams>
}

export const syncCallHistoryOAuth = async ({
	payload,
	credentials,
	sipgateUsersSlug,
	callLogsSlug,
	params,
}: SyncCallHistoryOAuthOptions): Promise<SyncResult> => {
	const clientId = credentials.clientId
	const clientSecret = credentials.clientSecret
	const realm = credentials.realm ?? 'third-party'

	if (!clientId || !clientSecret) {
		throw new Error('OAuth2 client credentials not configured for call log sync')
	}

	const connectedUsers = await payload.find({
		collection: sipgateUsersSlug as CollectionSlug,
		where: { accessToken: { exists: true } },
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	let synced = 0
	let errors = 0

	for (const _doc of connectedUsers.docs) {
		const doc = _doc as unknown as Record<string, unknown>
		const accessToken = doc.accessToken as string | undefined
		const refreshToken = doc.refreshToken as string | undefined
		if (!accessToken || !refreshToken) continue

		const docId = doc.id as string
		const sipgateId = doc.sipgateId as string
		const rest = buildSipgateRestOAuth({
			accessToken,
			refreshToken,
			clientId,
			clientSecret,
			realm,
			onRefresh: async (tokens) => {
				await payload.update({
					collection: sipgateUsersSlug as CollectionSlug,
					id: docId,
					data: {
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token,
						tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
					},
					overrideAccess: true,
				})
			},
		})

		try {
			const result = await syncCallHistory({
				payload,
				rest,
				callLogsSlug,
				params,
				sipgateUserId: sipgateId,
			})
			synced += result.synced
			errors += result.errors
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted: 0 }
}

/**
 * Returns an `onInit` handler that performs a full sync (users → devices → channels)
 * with pruning, removing any Payload records that no longer exist in sipgate.
 *
 * Usage in payload.config.ts:
 * ```ts
 * onInit: async (payload) => {
 *   await createSipgateOnInit(credentials)(payload)
 * }
 * ```
 */
export const createSipgateOnInit =
	(credentials: SipgateCredentials) =>
	async (payload: Payload): Promise<void> => {
		const rest = buildSipgateRest(credentials)
		await syncUsers({ payload, rest, sipgateUsersSlug: 'sipgate-users', prune: true })
		await syncDevices({
			payload,
			rest,
			sipgateDevicesSlug: 'sipgate-devices',
			sipgateUsersSlug: 'sipgate-users',
			prune: true,
		})
		await syncChannels({
			payload,
			rest,
			sipgateChannelsSlug: 'sipgate-channels',
			sipgateUsersSlug: 'sipgate-users',
			prune: true,
		})
	}
