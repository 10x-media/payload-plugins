import type { CollectionSlug, Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from '../utils/access'
import { checkAccess } from '../utils/access'
import { buildWmsClient } from '../utils/wildixClient'
import {
	type SyncResult,
	syncCallHistoryOAuth,
	syncChannels,
	syncDevices,
	tokenProviderForUser,
} from '../utils/wildixSyncHandlers'

export type OAuthSyncEntityType = 'devices' | 'channels' | 'call-logs' | 'all'

type CreateWildixOAuthSyncOptions = {
	credentials: WildixCredentials
	wildixUsersSlug: string
	wildixDevicesSlug: string
	wildixChannelsSlug: string
	callLogsSlug: string
	access?: WildixAccess
}

const emptyResult = (): SyncResult => ({ synced: 0, errors: 0, deleted: 0 })

export const createWildixOAuthSync = ({
	credentials,
	wildixUsersSlug,
	wildixDevicesSlug,
	wildixChannelsSlug,
	callLogsSlug,
	access,
}: CreateWildixOAuthSyncOptions): Endpoint => ({
	path: '/wildix/sync',
	method: 'post',
	handler: async (req) => {
		const denied = await checkAccess(req, access, 'sync')
		if (denied) return denied

		const body = (await req.json?.()) as { type?: OAuthSyncEntityType } | undefined
		const type: OAuthSyncEntityType = body?.type ?? 'all'

		const connectedUsers = await req.payload.find({
			collection: wildixUsersSlug as CollectionSlug,
			where: { accessToken: { exists: true } },
			limit: 1000,
			depth: 0,
			overrideAccess: true,
		})

		const totals: { devices: SyncResult; channels: SyncResult; 'call-logs'?: SyncResult } = {
			devices: emptyResult(),
			channels: emptyResult(),
		}

		for (const _doc of connectedUsers.docs) {
			const doc = _doc as unknown as Record<string, unknown>
			const provider = tokenProviderForUser({
				payload: req.payload,
				credentials,
				wildixUsersSlug,
				doc,
			})
			if (!provider) continue
			const wildixId = doc.wildixId as string
			const client = buildWmsClient(credentials, provider)

			if (type === 'devices' || type === 'all') {
				try {
					const token = await provider.token()
					const result = await syncDevices({
						payload: req.payload,
						credentials,
						token,
						wildixDevicesSlug,
						wildixUsersSlug,
						scopeToUserId: wildixId,
					})
					totals.devices.synced += result.synced
					totals.devices.errors += result.errors
				} catch {
					totals.devices.errors++
				}
			}

			if (type === 'channels' || type === 'all') {
				try {
					const result = await syncChannels({
						payload: req.payload,
						client,
						wildixChannelsSlug,
						wildixUsersSlug,
						scopeToUserId: wildixId,
					})
					totals.channels.synced += result.synced
					totals.channels.errors += result.errors
				} catch {
					totals.channels.errors++
				}
			}
		}

		if (type === 'call-logs' || type === 'all') {
			try {
				totals['call-logs'] = await syncCallHistoryOAuth({
					payload: req.payload,
					credentials,
					wildixUsersSlug,
					callLogsSlug,
				})
			} catch {
				totals['call-logs'] = { synced: 0, errors: 1, deleted: 0 }
			}
		}

		return Response.json({ ok: true, connectedUsers: connectedUsers.totalDocs, results: totals })
	},
})
