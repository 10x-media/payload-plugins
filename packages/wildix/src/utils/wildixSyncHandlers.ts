import {
	type CallRecord,
	QueryUserCallsCommand,
	type WdaHistoryClient,
} from '@wildix/wda-history-client'
import {
	GetPbxCallGroupsCommand,
	GetPbxColleaguesCommand,
	ListUserDevicesCommand,
	type PbxCallGroup,
	type PbxColleague,
	type UserDevice,
	type WmsApiClient,
} from '@wildix/wms-api-client'
import type { CollectionSlug, Payload } from 'payload'
import type { CallStatus, CallType, WildixCredentials } from '../types'
import { createOrUpdateCallLog } from './callLog'
import { upsertByField } from './upsertByField'
import { buildWdaClient, buildWmsClient } from './wildixClient'
import { buildRefreshingTokenProvider } from './wildixOAuthClient'

export type SyncResult = { synced: number; errors: number; deleted: number }

type SyncUsersOptions = {
	payload: Payload
	client: WmsApiClient
	wildixUsersSlug: string
	prune?: boolean
}

/** Upserts Wildix colleagues into the local collection, keyed by PBX user id. */
export const syncUsers = async ({
	payload,
	client,
	wildixUsersSlug,
	prune,
}: SyncUsersOptions): Promise<SyncResult> => {
	const response = await client.send(new GetPbxColleaguesCommand({ count: 1000 }))
	const colleagues: PbxColleague[] = response.result?.records ?? []
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const colleague of colleagues) {
		seenIds.add(colleague.id)
		try {
			await upsertByField({
				payload,
				collection: wildixUsersSlug,
				uniqueField: 'wildixId',
				uniqueValue: colleague.id,
				data: {
					wildixId: colleague.id,
					name: colleague.name,
					email: colleague.email,
					extension: colleague.extension,
					officePhone: colleague.officePhone,
					mobilePhone: colleague.mobilePhone,
					role: colleague.role,
					dialplan: colleague.dialplan,
					department: colleague.department,
					language: colleague.language,
				},
			})
			synced++
		} catch {
			errors++
		}
	}

	if (prune) {
		deleted += await pruneOrphans({
			payload,
			collection: wildixUsersSlug,
			uniqueField: 'wildixId',
			seen: seenIds,
			onError: () => {
				errors++
			},
		})
	}

	return { synced, errors, deleted }
}

type SyncDevicesOptions = {
	payload: Payload
	client: WmsApiClient
	wildixDevicesSlug: string
	wildixUsersSlug: string
	prune?: boolean
	/** When set, only syncs devices for this specific Wildix user id. Disables prune. */
	scopeToUserId?: string
}

/** Upserts devices for all (or one scoped) Wildix user via ListUserDevices, keyed by SIP contact. */
export const syncDevices = async ({
	payload,
	client,
	wildixDevicesSlug,
	wildixUsersSlug,
	prune,
	scopeToUserId,
}: SyncDevicesOptions): Promise<SyncResult> => {
	const usersResult = await payload.find({
		collection: wildixUsersSlug as CollectionSlug,
		where: scopeToUserId ? { wildixId: { equals: scopeToUserId } } : undefined,
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
		const wildixId = user.wildixId as string | undefined
		const extension = user.extension as string | undefined
		const payloadDocId = user.id as string
		if (!wildixId || !extension) {
			errors++
			continue
		}

		let devices: UserDevice[]
		let activeContact: string | undefined
		try {
			const response = await client.send(new ListUserDevicesCommand({ user: extension }))
			devices = response.devices ?? []
			activeContact = response.activeDevice?.contact
		} catch {
			errors++
			continue
		}

		for (const device of devices) {
			if (!device.contact || seen.has(device.contact)) continue
			seen.add(device.contact)
			try {
				await upsertByField({
					payload,
					collection: wildixDevicesSlug,
					uniqueField: 'contact',
					uniqueValue: device.contact,
					data: {
						contact: device.contact,
						userAgent: device.userAgent,
						online: device.active,
						isActiveDevice: device.contact === activeContact,
						wildixUserId: wildixId,
						wildixUser: payloadDocId,
					},
				})
				synced++
			} catch {
				errors++
			}
		}
	}

	if (prune && !scopeToUserId) {
		deleted += await pruneOrphans({
			payload,
			collection: wildixDevicesSlug,
			uniqueField: 'contact',
			seen,
			onError: () => {
				errors++
			},
		})
	}

	return { synced, errors, deleted }
}

type SyncChannelsOptions = {
	payload: Payload
	client: WmsApiClient
	wildixChannelsSlug: string
	wildixUsersSlug: string
	prune?: boolean
	scopeToUserId?: string
}

/** Upserts Wildix call groups (queues) into the local collection, keyed by group id. */
export const syncChannels = async ({
	payload,
	client,
	wildixChannelsSlug,
	wildixUsersSlug,
	prune,
	scopeToUserId,
}: SyncChannelsOptions): Promise<SyncResult> => {
	const response = await client.send(new GetPbxCallGroupsCommand({}))
	const allGroups: PbxCallGroup[] = response.result?.records ?? []
	const groups = scopeToUserId
		? allGroups.filter((g) => g.members.includes(scopeToUserId))
		: allGroups
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const group of groups) {
		const groupId = String(group.id)
		seenIds.add(groupId)
		try {
			const assignedUsers = await Promise.all(
				group.members.map(async (memberExtension) => {
					const result = await payload.find({
						collection: wildixUsersSlug as CollectionSlug,
						where: { extension: { equals: memberExtension } },
						limit: 1,
						overrideAccess: true,
					})
					const payloadDoc = result.docs[0]
					return {
						extension: memberExtension,
						user: payloadDoc ? payloadDoc.id : undefined,
					}
				})
			)

			await upsertByField({
				payload,
				collection: wildixChannelsSlug,
				uniqueField: 'wildixId',
				uniqueValue: groupId,
				data: {
					wildixId: groupId,
					name: group.title,
					assignedUsers,
					settings: {
						strategy: group.settings.strategy,
						timeout: group.settings.timeout,
						maxLen: group.settings.maxLen,
						wrapUpTime: group.settings.wrapUpTime,
						cid: group.settings.cid,
						queueManager: group.settings.queueManager,
					},
				},
			})
			synced++
		} catch {
			errors++
		}
	}

	if (prune && !scopeToUserId) {
		deleted += await pruneOrphans({
			payload,
			collection: wildixChannelsSlug,
			uniqueField: 'wildixId',
			seen: seenIds,
			onError: () => {
				errors++
			},
		})
	}

	return { synced, errors, deleted }
}

const CALL_DIRECTION_MAP: Record<string, CallType> = {
	INBOUND: 'in',
	OUTBOUND: 'out',
	INTERNAL: 'out',
}

const CALL_STATUS_MAP: Record<string, CallStatus> = {
	COMPLETED: 'completed',
	MISSED: 'missed',
}

type NormalizedCallLog = {
	callId: string
	callType: CallType
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt: Date
}

export function normalizeCallHistory(calls: CallRecord[]): NormalizedCallLog[] {
	return calls.flatMap((call) => {
		const callType = call.direction ? CALL_DIRECTION_MAP[call.direction] : undefined
		if (!callType) return []
		const callStatus = call.callStatus
			? (CALL_STATUS_MAP[call.callStatus] ?? 'completed')
			: 'completed'
		return [
			{
				callId: call.id,
				callType,
				callStatus,
				callDuration: call.talkTime ?? call.duration ?? 0,
				fromNumber: call.caller?.phone ?? '',
				toNumber: call.callee?.phone ?? call.destination ?? '',
				startedAt: new Date(call.startTime),
			},
		]
	})
}

type SyncCallHistoryOptions = {
	payload: Payload
	wda: WdaHistoryClient
	callLogsSlug: string
	company?: string
	/** PBX user id to scope the query and tag each log with. */
	userId?: string
	limit?: number
}

export const syncCallHistory = async ({
	payload,
	wda,
	callLogsSlug,
	company,
	userId,
	limit,
}: SyncCallHistoryOptions): Promise<SyncResult> => {
	const response = await wda.send(
		new QueryUserCallsCommand({
			company,
			user: userId,
			limit: limit ?? 100,
		})
	)
	const entries = normalizeCallHistory(response.calls ?? [])
	let synced = 0
	let errors = 0

	for (const entry of entries) {
		try {
			await createOrUpdateCallLog(payload, callLogsSlug, {
				...entry,
				...(userId ? { wildixUserId: userId } : {}),
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
	credentials: WildixCredentials
	wildixUsersSlug: string
	callLogsSlug: string
	limit?: number
}

/** Iterates every connected Wildix user and syncs their call history with their own token. */
export const syncCallHistoryOAuth = async ({
	payload,
	credentials,
	wildixUsersSlug,
	callLogsSlug,
	limit,
}: SyncCallHistoryOAuthOptions): Promise<SyncResult> => {
	const connectedUsers = await payload.find({
		collection: wildixUsersSlug as CollectionSlug,
		where: { accessToken: { exists: true } },
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	let synced = 0
	let errors = 0

	for (const _doc of connectedUsers.docs) {
		const doc = _doc as unknown as Record<string, unknown>
		const provider = tokenProviderForUser({ payload, credentials, wildixUsersSlug, doc })
		if (!provider) continue
		const wildixId = doc.wildixId as string
		try {
			const wda = buildWdaClient(credentials, provider)
			const result = await syncCallHistory({
				payload,
				wda,
				callLogsSlug,
				company: credentials.company,
				userId: wildixId,
				limit,
			})
			synced += result.synced
			errors += result.errors
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted: 0 }
}

type TokenProviderForUserOptions = {
	payload: Payload
	credentials: WildixCredentials
	wildixUsersSlug: string
	doc: Record<string, unknown>
}

/** Builds a refreshing token provider for a connected Wildix user doc, or null if tokens are missing. */
export const tokenProviderForUser = ({
	payload,
	credentials,
	wildixUsersSlug,
	doc,
}: TokenProviderForUserOptions) => {
	const accessToken = doc.accessToken as string | undefined
	const refreshToken = doc.refreshToken as string | undefined
	if (!accessToken || !refreshToken) return null
	const docId = doc.id as string
	const pbxHost = credentials.pbxHost ?? ''
	return buildRefreshingTokenProvider({
		accessToken,
		refreshToken,
		tokenExpiresAt: doc.tokenExpiresAt as string | undefined,
		pbxHost,
		clientId: credentials.clientId ?? '',
		clientSecret: credentials.clientSecret ?? '',
		onRefresh: async (tokens) => {
			await payload.update({
				collection: wildixUsersSlug as CollectionSlug,
				id: docId,
				data: {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
					tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
				},
				overrideAccess: true,
			})
		},
		onRefreshFailed: async () => {
			await payload.update({
				collection: wildixUsersSlug as CollectionSlug,
				id: docId,
				data: { needsReconnect: true } as Record<string, unknown>,
				overrideAccess: true,
			})
		},
	})
}

type PruneOrphansOptions = {
	payload: Payload
	collection: string
	uniqueField: string
	seen: Set<string>
	onError: () => void
}

const pruneOrphans = async ({
	payload,
	collection,
	uniqueField,
	seen,
	onError,
}: PruneOrphansOptions): Promise<number> => {
	let deleted = 0
	try {
		const orphans = await payload.find({
			collection: collection as CollectionSlug,
			where: { [uniqueField]: { not_in: [...seen] } },
			limit: 1000,
			depth: 0,
			overrideAccess: true,
		})
		for (const doc of orphans.docs) {
			try {
				await payload.delete({
					collection: collection as CollectionSlug,
					id: doc.id,
					overrideAccess: true,
				})
				deleted++
			} catch {
				onError()
			}
		}
	} catch {
		onError()
	}
	return deleted
}

/**
 * Returns an `onInit` handler that performs a full API-key sync (users, devices,
 * channels) with pruning. Removes local records no longer present in Wildix.
 */
export const createWildixOnInit =
	(credentials: WildixCredentials) =>
	async (payload: Payload): Promise<void> => {
		const client = buildWmsClient(credentials)
		await syncUsers({ payload, client, wildixUsersSlug: 'wildix-users', prune: true })
		await syncDevices({
			payload,
			client,
			wildixDevicesSlug: 'wildix-devices',
			wildixUsersSlug: 'wildix-users',
			prune: true,
		})
		await syncChannels({
			payload,
			client,
			wildixChannelsSlug: 'wildix-channels',
			wildixUsersSlug: 'wildix-users',
			prune: true,
		})
	}
