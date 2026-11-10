import type { CollectionSlug, JsonObject, Payload, PayloadRequest } from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription, SubscriptionOwnership } from '../options'
import { ownerRefusal } from '../plugin/owner'
import { decideDelivery, resolveSubscriptionById } from '../plugin/resolveSubscriptions'
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
	/** Re-check that the owner can still read what the delivery is about. */
	enforceOwnerAccess?: boolean
	/** Event id to the slug of the collection that emits it. */
	eventSources?: Record<string, string>
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
	// now, replaying would hand the previous owner's view of the document to the new one, and if the
	// owner has lost access since, it would hand them what they may no longer read. A check that
	// could not be made throws before the new row exists, so the caller gets an error, not a replay.
	const refusal = await ownerRefusal({
		ownership: deps.ownership,
		enforce: deps.enforceOwnerAccess ?? false,
		subscription,
		row: original,
		eventSources: deps.eventSources ?? {},
		req,
	})
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
			...(typeof original.ownerId === 'string'
				? { ownerId: original.ownerId, ownerCollection: original.ownerCollection }
				: {}),
			...(typeof original.documentId === 'string' ? { documentId: original.documentId } : {}),
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

	if (refusal) {
		await payload.update({
			collection: deps.deliveriesSlug as CollectionSlug,
			id: newId,
			data: { status: 'dead', error: refusal },
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
		// The caller's access to the replay was settled above; `jobs.access.queue` is about who may
		// queue arbitrary jobs, which a redelivery is not.
		await payload.jobs.queue({
			task: WEBHOOK_DELIVER_TASK,
			input: { deliveryId: newId },
			overrideAccess: true,
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
