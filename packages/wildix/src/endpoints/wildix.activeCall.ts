import { deepMerge, type Endpoint } from 'payload'
import type { WildixAccess } from '../utils/access'
import { wildixActiveCallHandler } from '../utils/wildixActiveCallHandler'

export const createWildixActiveCall = (
	access?: WildixAccess,
	overrides?: Partial<Endpoint>,
	wildixUsersSlug?: string
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/active-call',
		method: 'get',
		handler: wildixActiveCallHandler(access, wildixUsersSlug),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
