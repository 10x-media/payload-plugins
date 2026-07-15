import { deepMerge, type Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from '../utils/access'
import { checkAccess } from '../utils/access'
import { buildWdaClient, buildWmsClient } from '../utils/wildixClient'
import {
	type SyncResult,
	syncCallHistory,
	syncChannels,
	syncDevices,
	syncUsers,
} from '../utils/wildixSyncHandlers'

export type SyncEntityType = 'users' | 'devices' | 'channels' | 'call-logs' | 'all'

type CreateWildixSyncOptions = {
	credentials: WildixCredentials
	wildixUsersSlug: string
	wildixDevicesSlug: string
	wildixChannelsSlug: string
	callLogsSlug: string
	access?: WildixAccess
	overrides?: Partial<Endpoint>
}

export const createWildixSync = ({
	credentials,
	wildixUsersSlug,
	wildixDevicesSlug,
	wildixChannelsSlug,
	callLogsSlug,
	access,
	overrides,
}: CreateWildixSyncOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/sync',
		method: 'post',
		handler: async (req) => {
			const denied = await checkAccess(req, access, 'sync')
			if (denied) return denied

			const body = (await req.json?.()) as { type?: SyncEntityType } | undefined
			const type: SyncEntityType = body?.type ?? 'all'

			const client = buildWmsClient(credentials)
			const payload = req.payload
			const results: Record<string, SyncResult> = {}

			if (type === 'users' || type === 'all') {
				results.users = await syncUsers({ payload, client, wildixUsersSlug, prune: true })
			}
			if (type === 'devices' || type === 'all') {
				results.devices = await syncDevices({
					payload,
					client,
					wildixDevicesSlug,
					wildixUsersSlug,
					prune: true,
				})
			}
			if (type === 'channels' || type === 'all') {
				results.channels = await syncChannels({
					payload,
					client,
					wildixChannelsSlug,
					wildixUsersSlug,
					prune: true,
				})
			}
			if (type === 'call-logs') {
				const wda = buildWdaClient(credentials)
				results['call-logs'] = await syncCallHistory({
					payload,
					wda,
					callLogsSlug,
					company: credentials.company,
				})
			}

			return Response.json({ ok: true, results })
		},
	}

	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
