import { type CollectionSlug, deepMerge, type Endpoint } from 'payload'
import { sipgateActiveCallHandler } from '../utils/sipgateActiveCallHandler'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

export const createSipgateActiveCall = (
	contactCollections: CollectionSlug[],
	phoneNumberFields: string[],
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/active-call',
		method: 'get',
		handler: sipgateActiveCallHandler(contactCollections, phoneNumberFields),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
