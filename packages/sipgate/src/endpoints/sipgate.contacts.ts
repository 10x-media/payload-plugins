import { deepMerge, type Endpoint } from 'payload'
import { sipgateContactsHandler } from '../utils/sipgateContactsHandler'

export const createSipgateContacts = (overrides?: Partial<Endpoint>): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/contacts',
		method: 'get',
		handler: sipgateContactsHandler,
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
