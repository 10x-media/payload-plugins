import type { Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { checkAccess } from '../utils/access'
import { buildSipgateRestOAuth } from '../utils/sipgateOAuthRest'
import { syncChannels, syncDevices } from '../utils/sipgateSyncHandlers'

type CreateSipgateOAuthSyncOptions = {
	credentials: SipgateCredentials
	sipgateUsersSlug: string
	sipgateDevicesSlug: string
	sipgateChannelsSlug: string
	access?: SipgateAccess
}

export type OAuthSyncEntityType = 'devices' | 'channels' | 'all'

export const createSipgateOAuthSync = ({
	credentials,
	sipgateUsersSlug,
	sipgateDevicesSlug,
	sipgateChannelsSlug,
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
			collection: sipgateUsersSlug,
			where: { accessToken: { exists: true } },
			limit: 1000,
			depth: 0,
			overrideAccess: true,
		})

		const totals = {
			devices: { synced: 0, errors: 0 },
			channels: { synced: 0, errors: 0 },
		}

		for (const sipgateUserDoc of connectedUsers.docs) {
			const accessToken = sipgateUserDoc.accessToken as string | undefined
			const refreshToken = sipgateUserDoc.refreshToken as string | undefined
			if (!accessToken || !refreshToken) continue

			const docId = sipgateUserDoc.id as string
			const rest = buildSipgateRestOAuth({
				accessToken,
				refreshToken,
				clientId,
				clientSecret,
				realm,
				onRefresh: async (tokens) => {
					await req.payload.update({
						collection: sipgateUsersSlug,
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

			if (type === 'devices' || type === 'all') {
				try {
					const result = await syncDevices({
						payload: req.payload,
						rest,
						sipgateDevicesSlug,
						sipgateUsersSlug,
						scopeToUserId: docId,
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
						scopeToUserId: docId,
					})
					totals.channels.synced += result.synced
					totals.channels.errors += result.errors
				} catch {
					totals.channels.errors++
				}
			}
		}

		return Response.json({ ok: true, connectedUsers: connectedUsers.totalDocs, results: totals })
	},
})
