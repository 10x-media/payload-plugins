import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { checkAccess } from '../utils/access'
import { buildSipgateRest } from '../utils/sipgate.rest'
import { syncChannels, syncDevices, syncUsers } from '../utils/sipgateSyncHandlers'

export type SyncEntityType = 'users' | 'devices' | 'channels' | 'all'

type CreateSipgateSyncOptions = {
	credentials: SipgateCredentials
	sipgateUsersSlug: string
	sipgateDevicesSlug: string
	sipgateChannelsSlug: string
	access?: SipgateAccess
	overrides?: Partial<Endpoint>
}

export const createSipgateSync = ({
	credentials,
	sipgateUsersSlug,
	sipgateDevicesSlug,
	sipgateChannelsSlug,
	access,
	overrides,
}: CreateSipgateSyncOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/sync',
		method: 'post',
		handler: async (req) => {
			const denied = await checkAccess(req, access, 'sync')
			if (denied) return denied

			const body = (await req.json?.()) as { type?: SyncEntityType } | undefined
			const type: SyncEntityType = body?.type ?? 'all'

			const rest = buildSipgateRest(credentials)
			const payload = req.payload

			const results: Record<string, { synced: number; errors: number }> = {}

			if (type === 'users' || type === 'all') {
				results.users = await syncUsers({ payload, rest, sipgateUsersSlug })
			}
			if (type === 'devices' || type === 'all') {
				results.devices = await syncDevices({
					payload,
					rest,
					sipgateDevicesSlug,
					sipgateUsersSlug,
				})
			}
			if (type === 'channels' || type === 'all') {
				results.channels = await syncChannels({
					payload,
					rest,
					sipgateChannelsSlug,
					sipgateUsersSlug,
				})
			}

			return Response.json({ ok: true, results })
		},
	}

	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
