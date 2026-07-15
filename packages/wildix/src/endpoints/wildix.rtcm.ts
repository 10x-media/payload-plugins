import { deepMerge, type Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from '../utils/access'
import { wildixRtcmHandler } from '../utils/wildixRtcmHandler'

type CreateWildixRtcmOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	wildixUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createWildixRtcm = ({
	credentials,
	access,
	wildixUsersSlug,
	overrides,
}: CreateWildixRtcmOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/rtcm',
		method: 'post',
		handler: wildixRtcmHandler({ credentials, access, wildixUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
