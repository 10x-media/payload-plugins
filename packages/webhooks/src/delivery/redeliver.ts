import type { Payload, PayloadRequest } from 'payload'

import type { DeliveryRow } from '../collections/deliveries'
import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription } from '../options'
import { decideDelivery, resolveSubscriptionById } from '../plugin/resolveSubscriptions'
import { asRow, asSlug } from '../plugin/slug'
import { sendDelivery } from './sendDelivery'

/** Dependencies for re-dispatching a stored delivery. */
export type RedeliverDeps = {
	deliveriesSlug: string
	subscriptionsSlug: string
	codeSubscriptions: CodeSubscription[]
	mode: 'queue' | 'inline'
	timeoutMs: number
	queue: string
}

/** Re-dispatch a past delivery from its stored payload, creating a new linked row. */
export const redeliverDelivery = async (args: {
	deps: RedeliverDeps
	deliveryId: string
	payload: Payload
	req: PayloadRequest
}): Promise<{ id: string }> => {
	const { deps, deliveryId, payload, req } = args
	const original = asRow<DeliveryRow>(
		await payload.findByID({
			collection: asSlug(deps.deliveriesSlug),
			id: deliveryId,
			overrideAccess: true,
			req,
		})
	)
	// Resolved up front (cheap) so the new row's endpoint reflects the subscription's current URL
	// rather than whatever was stored at the time of the original delivery.
	const subscription = await resolveSubscriptionById({
		id: String(original.subscriptionId),
		codeSubscriptions: deps.codeSubscriptions,
		subscriptionsSlug: deps.subscriptionsSlug,
		payload,
		req,
	})
	const created = await payload.create({
		collection: asSlug(deps.deliveriesSlug),
		data: {
			subscriptionId: original.subscriptionId,
			endpoint: subscription?.url ?? original.endpoint,
			event: original.event,
			payload: original.payload,
			status: 'pending',
			attempt: 0,
		},
		overrideAccess: true,
		req,
	})
	const newId = String(created.id)

	if (deps.mode === 'queue') {
		// deliverTask re-resolves the subscription (and re-checks enabled) when it runs, so no
		// missing/disabled gate is needed here.
		await payload.jobs.queue({
			task: WEBHOOK_DELIVER_TASK,
			input: { deliveryId: newId },
			queue: deps.queue,
		})
		return { id: newId }
	}

	const decision = decideDelivery(subscription)
	if (!decision.deliverable) {
		await payload.update({
			collection: asSlug(deps.deliveriesSlug),
			id: newId,
			data: { status: 'dead', error: decision.reason },
			overrideAccess: true,
			req,
		})
		return { id: newId }
	}
	const result = await sendDelivery({
		subscription: decision.subscription,
		deliveryId: newId,
		event: String(original.event),
		body: JSON.stringify(original.payload),
		timeoutMs: deps.timeoutMs,
		now: Date.now(),
	})
	await payload.update({
		collection: asSlug(deps.deliveriesSlug),
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
	return { id: newId }
}
