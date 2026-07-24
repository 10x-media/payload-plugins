import {
	GetPbxCallGroupsCommand,
	GetPbxColleaguesCommand,
	type PbxCallGroup,
	type PbxColleague,
	type WmsApiClient,
} from '@wildix/wms-api-client'
import type { CollectionSlug, Payload } from 'payload'
import type { WildixCredentials } from '../types'
import { createOrUpdateCallLog } from './callLog'
import { upsertByField } from './upsertByField'
import { buildWmsClient } from './wildixClient'
import { buildRefreshingTokenProvider } from './wildixOAuthClient'
import {
	fetchPbxCallHistory,
	fetchUserCallHistory,
	normalizePbxCallHistory,
	type PbxCallHistoryRecord,
} from './wildixPbxHistory'
import {
	fetchPbxDevices,
	fetchPbxSipRegistrations,
	type NormalizedPbxDevice,
	normalizePbxDevice,
	normalizePbxSipRegistrations,
} from './wildixPbxRest'

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
	credentials: WildixCredentials
	wildixDevicesSlug: string
	wildixUsersSlug: string
	prune?: boolean
	/** When set, only syncs devices assigned to this Wildix user id. Disables prune. */
	scopeToUserId?: string
	/** OAuth2 access token override; falls back to the static apiKey when absent. */
	token?: string
}

type LinkedUser = { id: string; wildixId?: string }

/** Upserts hardware (`/Devices/`) and softphones (`/PBX/Users/Sip/Registrations`), keyed by wildixId. */
export const syncDevices = async ({
	payload,
	credentials,
	wildixDevicesSlug,
	wildixUsersSlug,
	prune,
	scopeToUserId,
	token,
}: SyncDevicesOptions): Promise<SyncResult> => {
	const usersResult = await payload.find({
		collection: wildixUsersSlug as CollectionSlug,
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	const userByExtension = new Map<string, LinkedUser>()
	let scopeExtension: string | undefined
	for (const _user of usersResult.docs) {
		const user = _user as unknown as Record<string, unknown>
		const extension = user.extension as string | undefined
		const wildixId = user.wildixId as string | undefined
		if (extension) userByExtension.set(extension, { id: user.id as string, wildixId })
		if (scopeToUserId && wildixId === scopeToUserId) scopeExtension = extension
	}

	if (scopeToUserId && !scopeExtension) return { synced: 0, errors: 0, deleted: 0 }

	const devices: NormalizedPbxDevice[] = []
	let errors = 0

	try {
		const hardware = await fetchPbxDevices({ credentials, token })
		for (const record of hardware) {
			const device = normalizePbxDevice(record)
			if (device) devices.push(device)
		}
	} catch {
		errors++
	}

	try {
		const registrations = await fetchPbxSipRegistrations({
			credentials,
			token,
			extensions: scopeExtension,
		})
		devices.push(...normalizePbxSipRegistrations(registrations))
	} catch {
		errors++
	}

	const seen = new Set<string>()
	let synced = 0
	let deleted = 0

	for (const device of devices) {
		if (scopeExtension && device.extension !== scopeExtension) continue
		if (seen.has(device.wildixId)) continue
		seen.add(device.wildixId)

		const linked = device.extension ? userByExtension.get(device.extension) : undefined
		try {
			await upsertByField({
				payload,
				collection: wildixDevicesSlug,
				uniqueField: 'wildixId',
				uniqueValue: device.wildixId,
				data: {
					wildixId: device.wildixId,
					contact: device.contact,
					userAgent: device.userAgent,
					online: device.online,
					isActiveDevice: device.online,
					wildixUserId: linked?.wildixId,
					wildixUser: linked?.id,
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
			collection: wildixDevicesSlug,
			uniqueField: 'wildixId',
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

type SyncCallHistoryPbxOptions = {
	payload: Payload
	credentials: WildixCredentials
	wildixUsersSlug: string
	callLogsSlug: string
	/** Max records per user extension. @default 100 */
	limit?: number
}

/**
 * Syncs call logs via WMS admin CallHistory (`/api/v1/User/{extension}/CallHistory/`),
 * falling back to the org-wide `/api/v1/PBX/CallHistory/` when no user has an extension
 * yet. Uses the static apiKey token, so no company id is required.
 */
export const syncCallHistoryPbx = async ({
	payload,
	credentials,
	wildixUsersSlug,
	callLogsSlug,
	limit,
}: SyncCallHistoryPbxOptions): Promise<SyncResult> => {
	const usersResult = await payload.find({
		collection: wildixUsersSlug as CollectionSlug,
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	let synced = 0
	let errors = 0
	const seenCallIds = new Set<string>()
	let usersWithExtension = 0

	for (const _user of usersResult.docs) {
		const user = _user as unknown as Record<string, unknown>
		const extension = user.extension as string | undefined
		const wildixId = user.wildixId as string | undefined
		if (!extension) continue
		usersWithExtension++

		let records: PbxCallHistoryRecord[]
		try {
			records = await fetchUserCallHistory({
				credentials,
				extension,
				count: limit ?? 100,
			})
		} catch {
			errors++
			continue
		}

		const entries = normalizePbxCallHistory(records, extension)
		for (const entry of entries) {
			if (seenCallIds.has(entry.callId)) continue
			seenCallIds.add(entry.callId)
			try {
				await createOrUpdateCallLog(payload, callLogsSlug, {
					...entry,
					...(wildixId ? { wildixUserId: wildixId } : {}),
				})
				synced++
			} catch {
				errors++
			}
		}
	}

	// No users have extensions yet (e.g. before the first user sync): fall back to
	// the org-wide history so the Sync Call History button still fills logs.
	if (usersWithExtension === 0) {
		let records: PbxCallHistoryRecord[]
		try {
			records = await fetchPbxCallHistory({ credentials, count: limit ?? 100 })
		} catch {
			return { synced, errors: errors + 1, deleted: 0 }
		}
		for (const entry of normalizePbxCallHistory(records)) {
			if (seenCallIds.has(entry.callId)) continue
			seenCallIds.add(entry.callId)
			try {
				await createOrUpdateCallLog(payload, callLogsSlug, entry)
				synced++
			} catch {
				errors++
			}
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

/**
 * Iterates every connected Wildix user and syncs their call history from the WMS
 * User CallHistory endpoint using that user's own OAuth2 access token.
 */
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
	const seenCallIds = new Set<string>()

	for (const _doc of connectedUsers.docs) {
		const doc = _doc as unknown as Record<string, unknown>
		const extension = doc.extension as string | undefined
		const wildixId = doc.wildixId as string | undefined
		if (!extension) continue
		const provider = tokenProviderForUser({ payload, credentials, wildixUsersSlug, doc })
		if (!provider) continue

		let records: PbxCallHistoryRecord[]
		try {
			const token = await provider.token()
			records = await fetchUserCallHistory({
				credentials,
				token,
				extension,
				count: limit ?? 100,
			})
		} catch {
			errors++
			continue
		}

		for (const entry of normalizePbxCallHistory(records, extension)) {
			if (seenCallIds.has(entry.callId)) continue
			seenCallIds.add(entry.callId)
			try {
				await createOrUpdateCallLog(payload, callLogsSlug, {
					...entry,
					...(wildixId ? { wildixUserId: wildixId } : {}),
				})
				synced++
			} catch {
				errors++
			}
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
				} as Record<string, unknown>,
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
			credentials,
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
