import type { Endpoint } from 'payload'
import { sipgateWebhookHandler } from '../utils/sipgateWebhookHandler'

type SipgateWebhooks = {
	endpoints: Endpoint[]
}

export const sipgateWebhooks: SipgateWebhooks = {
	endpoints: [
		{
			path: '/sipgate/webhooks',
			method: 'post',
			handler: sipgateWebhookHandler,
		},
	],
}
