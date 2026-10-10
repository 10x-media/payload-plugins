import type { CollectionSlug, JsonObject, Payload, PayloadRequest } from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription, SubscriptionOwnership } from '../options'
import { ownerStamp, resolveOwner } from '../plugin/owner'
import {
	decideDelivery,
	resolveSubscriptionById,
	subscriptionInfo,
} from '../plugin/resolveSubscriptions'
import type { UrlPolicy } from './destination'
import { messageId, sendDelivery } from './sendDelivery'

/** Dependencies for re-dispatching a stored delivery. */
export type RedeliverDeps = {
	deliveriesSlug: string
	subscriptionsSlug: string
	codeSubscriptions: CodeSubscription[]
	mode: 'queue' | 'inline'
	timeoutMs: number
	queue: string
	urlPolicy: UrlPolicy
	/** Set when `owner` is configured: a replay is then held to the owner it was made for. */
	ownership?: SubscriptionOwnership
}

/**
 * The new delivery, and how far it got before this returned: `pending` when it was queued, the
 * outcome when it was sent inline. The caller needs the difference, because "queued" is the wrong
 * thing to tell an operator whose replay has just been refused or rejected.
 */
export type RedeliverResult = { id: string; status: 'dead' | 'pending' | 'success' }

/** Re-dispatch a past delivery from its stored payload, creating a new linked row. */
export const redeliverDelivery = async (args: {
	deps: RedeliverDeps
	deliveryId: string
	payload: Payload
	req: PayloadRequest
}): Promise<RedeliverResult> => {
	const { deps, deliveryId, payload, req } = args
	// The slug is a runtime option, so Payload cannot resolve a document type from it; `JsonObject`
	// is its own shape for exactly that case.
	const original: JsonObject = await payload.findByID({
		collection: deps.deliveriesSlug as CollectionSlug,
		id: deliveryId,
		overrideAccess: true,
		req,
	})
	// Resolved up front (cheap) so the new row's endpoint reflects the subscription's current URL
	// rather than whatever was stored at the time of the original delivery.
	const subscription = await resolveSubscriptionById({
		id: String(original.subscriptionId),
		source: original.subscriptionSource,
		codeSubscriptions: deps.codeSubscriptions,
		subscriptionsSlug: deps.subscriptionsSlug,
		payload,
		req,
	})
	// The stored body was built for whoever owned the subscription then. If it acts as someone else
	// now, replaying would hand the previous owner's view of the document to the new one.
	const madeFor = {
		ownerId: typeof original.ownerId === 'string' ? original.ownerId : undefined,
		ownerCollection:
			typeof original.ownerCollection === 'string' ? original.ownerCollection : undefined,
	}
	const actsAs =
		deps.ownership && subscription
			? ownerStamp(
					await resolveOwner({
						ownership: deps.ownership,
						subscription: subscriptionInfo(subscription),
						req,
					})
				)
			: madeFor
	const ownerChanged =
		(actsAs.ownerId ?? '') !== (madeFor.ownerId ?? '') ||
		(actsAs.ownerCollection ?? '') !== (madeFor.ownerCollection ?? '')
	const created = await payload.create({
		collection: deps.deliveriesSlug as CollectionSlug,
		data: {
			subscriptionId: original.subscriptionId,
			subscriptionSource: original.subscriptionSource ?? subscription?.source,
			endpoint: subscription?.url ?? original.endpoint,
			event: original.event,
			status: 'pending',
			attempt: 0,
			// Carried over, so the replay stays visible to the owner it belongs to instead of becoming
			// an unowned row holding their payload.
			...(madeFor.ownerId ? madeFor : {}),
		},
		overrideAccess: true,
		req,
	})
	const newId = String(created.id)
	// A replay is a new delivery with its own `webhook-id`, so the body is restamped to match it.
	const body = { ...(original.payload as JsonObject), id: messageId(newId) }
	await payload.update({
		collection: deps.deliveriesSlug as CollectionSlug,
		id: newId,
		data: { payload: body },
		overrideAccess: true,
		req,
	})

	if (ownerChanged) {
		await payload.update({
			collection: deps.deliveriesSlug as CollectionSlug,
			id: newId,
			data: {
				status: 'dead',
				error:
					'the subscription changed owner since this delivery was made, so it was not replayed',
			},
			overrideAccess: true,
			req,
		})
		return { id: newId, status: 'dead' }
	}

	// Decided before queuing as well as before sending. The task decides again when it runs, but
	// a replay that can already be seen to be going nowhere (subscription gone, disabled, host
	// off the list) should say so now, not report itself as queued.
	const decision = decideDelivery(subscription, deps.urlPolicy)
	if (!decision.deliverable) {
		await payload.update({
			collection: deps.deliveriesSlug as CollectionSlug,
			id: newId,
			data: { status: 'dead', error: decision.reason },
			overrideAccess: true,
			req,
		})
		return { id: newId, status: 'dead' }
	}

	if (deps.mode === 'queue') {
		await payload.jobs.queue({
			task: WEBHOOK_DELIVER_TASK,
			input: { deliveryId: newId },
			queue: deps.queue,
			req,
		})
		return { id: newId, status: 'pending' }
	}
	const result = await sendDelivery({
		subscription: decision.subscription,
		deliveryId: newId,
		event: String(original.event),
		body: JSON.stringify(body),
		timeoutMs: deps.timeoutMs,
		now: Date.now(),
		urlPolicy: deps.urlPolicy,
	})
	await payload.update({
		collection: deps.deliveriesSlug as CollectionSlug,
		id: newId,
		data: {
			status: result.ok ? 'success' : 'dead',
			attempt: 1,
			responseStatus: result.responseStatus,
			responseBody: result.responseBody,
			error: result.error,
			durationMs: result.durationMs,
		},
		overrideAccess: true,
		req,
	})
	return { id: newId, status: result.ok ? 'success' : 'dead' }
}
