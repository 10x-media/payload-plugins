import { type CollectionSlug, deepMerge, type Endpoint } from 'payload'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

type CreateSipgateWebhooksOptions = {
	contactCollections: CollectionSlug[]
	phoneNumberFields: string[]
	callLogsSlug: string
	overrides?: Partial<Endpoint>
}

export const createSipgateWebhooks = ({
	contactCollections,
	phoneNumberFields,
	callLogsSlug,
	overrides,
}: CreateSipgateWebhooksOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/webhooks',
		method: 'post',
		handler: sipgateWebhookHandler(contactCollections, phoneNumberFields, callLogsSlug),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
