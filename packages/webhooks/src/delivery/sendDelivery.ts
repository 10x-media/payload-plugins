import { MESSAGE_ID_PREFIX } from '../constants'
import type { ResolvedSubscription } from '../plugin/resolveSubscriptions'
import { type DeliverResult, deliver } from './deliver'
import { withoutReservedHeaders } from './headers'
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
	// Backstop for the dispatchers' own refusal check, so no future call site can reintroduce a
	// silent downgrade to unsigned by forgetting it.
	if (subscription.secretUnusable) {
		throw new Error(
			`@10x-media/webhooks: refusing to send delivery ${deliveryId} for subscription ${subscription.id}: its signing secret could not be decrypted.`
		)
	}
	if (subscription.secretHidden) {
		throw new Error(
			`@10x-media/webhooks: refusing to send delivery ${deliveryId} for subscription ${subscription.id}: its signing secret was resolved without the raw window, so the ciphertext was stripped before it got here.`
		)
	}
	const timestamp = Math.floor(now / 1000)
	// Opaque and stable across retries, rather than the delivery row's primary key: on a SQL
	// adapter that key is a sequential integer, so consecutive deliveries would publish this
	// install's volume to every receiver and make a poor dedupe key for anyone consuming webhooks
	// from more than one source. The MAC covers it, so both sides must use the same string.
	const messageId = `${MESSAGE_ID_PREFIX}${deliveryId}`
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': USER_AGENT,
		'webhook-id': messageId,
		'webhook-timestamp': String(timestamp),
		'X-Webhook-Event': event,
		...withoutReservedHeaders(subscription.headers),
	}
	if (subscription.secrets.length) {
		headers['webhook-signature'] = signatureHeader(
			subscription.secrets.map((secret) => signPayload({ secret, id: messageId, timestamp, body }))
		)
	}
	return deliver({ url: subscription.url, body, headers, timeoutMs })
}
