import type { ResolvedSubscription } from '../plugin/resolveSubscriptions'
import { type DeliverResult, deliver } from './deliver'
import { signatureHeader, signPayload } from './sign'

const USER_AGENT = '10x-media-webhooks'

/** Assemble headers (+ signature) and POST the body to the subscription's URL. */
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
		...subscription.headers,
		'X-Webhook-Id': deliveryId,
		'X-Webhook-Event': event,
		'X-Webhook-Timestamp': String(timestamp),
	}
	if (subscription.secret) {
		headers['X-Webhook-Signature'] = signatureHeader(
			signPayload({ secret: subscription.secret, timestamp, body })
		)
	}
	return deliver({ url: subscription.url, body, headers, timeoutMs })
}
