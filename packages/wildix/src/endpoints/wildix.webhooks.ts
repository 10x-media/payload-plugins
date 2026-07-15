import { deepMerge, type Endpoint } from 'payload'
import { wildixWebhookHandler } from '../utils/wildixWebhookHandler'

type CreateWildixWebhooksOptions = {
	callLogsSlug: string
	webhookSecret?: string
	overrides?: Partial<Endpoint>
}

export const createWildixWebhooks = ({
	callLogsSlug,
	webhookSecret,
	overrides,
}: CreateWildixWebhooksOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/wildix/webhooks',
		method: 'post',
		handler: wildixWebhookHandler({ callLogsSlug, webhookSecret }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
