import { deepMerge, type Endpoint } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from '../utils/access'
import { sipgateContactsHandler } from '../utils/sipgateContactsHandler'

export const createSipgateContacts = (
	credentials: SipgateCredentials,
	access?: SipgateAccess,
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/contacts',
		method: 'get',
		handler: sipgateContactsHandler(credentials, access),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
