import { deepMerge, type Endpoint } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from '../utils/access'
import { wildixContactsHandler } from '../utils/wildixContactsHandler'

type CreateWildixContactsOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	wildixUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createWildixContacts = ({
	credentials,
	access,
	wildixUsersSlug,
	overrides,
}: CreateWildixContactsOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/contacts',
		method: 'get',
		handler: wildixContactsHandler({ credentials, access, wildixUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
