import type { CollectionSlug, Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { checkAccess } from '../utils/access'
import { buildSipgateRestOAuth } from '../utils/sipgateOAuthRest'
import { syncCallHistoryOAuth, syncChannels, syncDevices } from '../utils/sipgateSyncHandlers'

type CreateSipgateOAuthSyncOptions = {
	credentials: SipgateCredentials
	sipgateUsersSlug: string
	sipgateDevicesSlug: string
	sipgateChannelsSlug: string
	callLogsSlug: string
	access?: SipgateAccess
}

export type OAuthSyncEntityType = 'devices' | 'channels' | 'call-logs' | 'all'

export const createSipgateOAuthSync = ({
	credentials,
	sipgateUsersSlug,
	sipgateDevicesSlug,
	sipgateChannelsSlug,
	callLogsSlug,
	access,
}: CreateSipgateOAuthSyncOptions): Endpoint => ({
	path: '/sipgate/sync',
	method: 'post',
	handler: async (req) => {
		const denied = await checkAccess(req, access, 'sync')
		if (denied) return denied

		const body = (await req.json?.()) as { type?: OAuthSyncEntityType } | undefined
		const type: OAuthSyncEntityType = body?.type ?? 'all'

		const clientId = credentials.clientId
		const clientSecret = credentials.clientSecret
		const realm = credentials.realm ?? 'third-party'

		if (!clientId || !clientSecret) {
			return Response.json({ error: 'OAuth2 client credentials not configured' }, { status: 500 })
		}

		const connectedUsers = await req.payload.find({
			collection: sipgateUsersSlug as CollectionSlug,
			where: { accessToken: { exists: true } },
			limit: 1000,
			depth: 0,
			overrideAccess: true,
		})

		const totals: {
			devices: { synced: number; errors: number; deleted: number }
			channels: { synced: number; errors: number; deleted: number }
			'call-logs'?: { synced: number; errors: number; deleted: number }
		} = {
			devices: { synced: 0, errors: 0, deleted: 0 },
			channels: { synced: 0, errors: 0, deleted: 0 },
		}

		for (const _doc of connectedUsers.docs) {
			const sipgateUserDoc = _doc as unknown as Record<string, unknown>
			const accessToken = sipgateUserDoc.accessToken as string | undefined
			const refreshToken = sipgateUserDoc.refreshToken as string | undefined
			if (!accessToken || !refreshToken) continue

			const docId = sipgateUserDoc.id as string
			const sipgateId = sipgateUserDoc.sipgateId as string
			const rest = buildSipgateRestOAuth({
				accessToken,
				refreshToken,
				clientId,
				clientSecret,
				realm,
				onRefresh: async (tokens) => {
					await req.payload.update({
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
				onRefreshFailed: async () => {
					await req.payload.update({
						collection: sipgateUsersSlug as CollectionSlug,
						id: docId,
						data: { needsReconnect: true } as Record<string, unknown>,
						overrideAccess: true,
					})
				},
			})

			if (type === 'devices' || type === 'all') {
				try {
					const result = await syncDevices({
						payload: req.payload,
						rest,
						sipgateDevicesSlug,
						sipgateUsersSlug,
						scopeToUserId: sipgateId,
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
						rest,
						sipgateChannelsSlug,
						sipgateUsersSlug,
						scopeToUserId: sipgateId,
					})
					totals.channels.synced += result.synced
					totals.channels.errors += result.errors
				} catch {
					totals.channels.errors++
				}
			}
		}

		if (type === 'call-logs') {
			try {
				const result = await syncCallHistoryOAuth({
					payload: req.payload,
					credentials,
					sipgateUsersSlug,
					callLogsSlug,
				})
				totals['call-logs'] = result
			} catch {
				totals['call-logs'] = {
					synced: 0,
					errors: 1,
					deleted: 0,
				}
			}
		}

		return Response.json({ ok: true, connectedUsers: connectedUsers.totalDocs, results: totals })
	},
})
