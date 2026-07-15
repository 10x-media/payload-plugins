import { deepMerge, type Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from '../utils/access'
import { createWildixDialHandler } from '../utils/wildixDialHandler'

type CreateWildixDialOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	singleUserEmail?: string
	wildixUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createWildixDial = ({
	credentials,
	access,
	singleUserEmail,
	wildixUsersSlug,
	overrides,
}: CreateWildixDialOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/dial',
		method: 'post',
		handler: createWildixDialHandler({ credentials, access, singleUserEmail, wildixUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
