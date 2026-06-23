import { type CollectionSlug, deepMerge, type Endpoint } from 'payload'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

export const createSipgateWebhooks = (
	contactCollections: CollectionSlug[],
	phoneNumberFields: string[],
	overrides?: Partial<Endpoint>
): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/webhooks',
		method: 'post',
		handler: sipgateWebhookHandler(contactCollections, phoneNumberFields),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
