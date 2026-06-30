import { type CollectionSlug, deepMerge, type Endpoint } from 'payload'
import type { IvrOptions } from '../utils/sipgateWebhookHandler'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

type CreateSipgateWebhooksOptions = {
	contactCollections: CollectionSlug[]
	phoneNumberFields: string[]
	callLogsSlug: string
	ivr?: IvrOptions
	overrides?: Partial<Endpoint>
}

export const createSipgateWebhooks = ({
	contactCollections,
	phoneNumberFields,
	callLogsSlug,
	ivr,
	overrides,
}: CreateSipgateWebhooksOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/webhooks',
		method: 'post',
		handler: sipgateWebhookHandler({ contactCollections, phoneNumberFields, callLogsSlug, ivr }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
