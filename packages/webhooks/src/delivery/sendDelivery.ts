import { MESSAGE_ID_PREFIX } from '../constants'
import type { ResolvedSubscription } from '../plugin/resolveSubscriptions'
import { type DeliverResult, deliver } from './deliver'
import { withoutReservedHeaders } from './headers'
import { signatureHeader, signPayload } from './sign'

const USER_AGENT = '10x-media-webhooks'

/**
 * The id a receiver sees for one delivery, in the `webhook-id` header and as the body's `id`.
 *
 * Opaque rather than the delivery row's primary key: on a SQL adapter that key is a sequential
 * integer, so consecutive deliveries would publish this install's volume to every receiver and
 * make a poor dedupe key for anyone consuming webhooks from more than one source. The MAC covers
 * the header, so both sides must use the same string, and the body carries the same one so the
 * two cannot be told apart.
 */
export const messageId = (deliveryId: string): string => `${MESSAGE_ID_PREFIX}${deliveryId}`

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
	// Stable across retries, since a retry re-sends the same delivery row.
	const id = messageId(deliveryId)
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': USER_AGENT,
		'webhook-id': id,
		'webhook-timestamp': String(timestamp),
		'X-Webhook-Event': event,
		...withoutReservedHeaders(subscription.headers),
	}
	if (subscription.secrets.length) {
		headers['webhook-signature'] = signatureHeader(
			subscription.secrets.map((secret) => signPayload({ secret, id, timestamp, body }))
		)
	}
	return deliver({ url: subscription.url, body, headers, timeoutMs })
}
