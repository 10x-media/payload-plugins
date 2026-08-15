import type { ResolvedSubscription } from '../plugin/resolveSubscriptions'
import { type DeliverResult, deliver } from './deliver'
import { signatureHeader, signPayload } from './sign'

const USER_AGENT = '10x-media-webhooks'

/**
 * Assemble headers (+ signatures) and POST the body to the subscription's URL. The `body` string
 * is signed and sent unchanged: the Standard Webhooks MAC covers the exact transmitted bytes, so
 * nothing may parse and re-serialize it between here and the wire.
 */
export const sendDelivery = (args: {
	subscription: ResolvedSubscription
	deliveryId: string
	event: string
	body: string
	timeoutMs: number
	now: number
}): Promise<DeliverResult> => {
	const { subscription, deliveryId, event, body, timeoutMs, now } = args
	const timestamp = Math.floor(now / 1000)
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': USER_AGENT,
		'webhook-id': deliveryId,
		'webhook-timestamp': String(timestamp),
		'X-Webhook-Event': event,
		...subscription.headers,
	}
	if (subscription.secrets.length) {
		headers['webhook-signature'] = signatureHeader(
			subscription.secrets.map((secret) => signPayload({ secret, id: deliveryId, timestamp, body }))
		)
	}
	return deliver({ url: subscription.url, body, headers, timeoutMs })
}
