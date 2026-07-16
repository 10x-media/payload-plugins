import { deepMerge, type Endpoint } from 'payload'
import type { IvrOptions } from '../utils/sipgateWebhookHandler'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

type CreateSipgateWebhooksOptions = {
	callLogsSlug: string
	ivr?: IvrOptions
	webhookUrl?: string
	overrides?: Partial<Endpoint>
}

export const createSipgateWebhooks = ({
	callLogsSlug,
	ivr,
	webhookUrl,
	overrides,
}: CreateSipgateWebhooksOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/webhooks',
		method: 'post',
		handler: sipgateWebhookHandler({ callLogsSlug, ivr, webhookUrl }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
