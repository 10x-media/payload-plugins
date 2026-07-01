import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { sipgateContactsHandler } from '../utils/sipgateContactsHandler'

type CreateSipgateContactsOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	sipgateUsersSlug?: string
	overrides?: Partial<Endpoint>
}

export const createSipgateContacts = ({
	credentials,
	access,
	sipgateUsersSlug,
	overrides,
}: CreateSipgateContactsOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/contacts',
		method: 'get',
		handler: sipgateContactsHandler({ credentials, access, sipgateUsersSlug }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
