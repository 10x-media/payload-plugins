import type { TaskConfig } from 'payload'

import type { DeliveryRow } from '../collections/deliveries'
import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription } from '../options'
import { decideDelivery, resolveSubscriptionById } from '../plugin/resolveSubscriptions'
import { asRow, asSlug } from '../plugin/slug'
import { deriveDeliveryStatus } from './deriveDeliveryStatus'
import { sendDelivery } from './sendDelivery'

/** Shared dependencies the delivery task closes over. */
export type DeliverTaskDeps = {
	deliveriesSlug: string
	subscriptionsSlug: string
	codeSubscriptions: CodeSubscription[]
	timeoutMs: number
	retries: number
}

/** Native Payload jobs task that performs one queued delivery attempt. */
export const buildDeliverTask = (deps: DeliverTaskDeps): TaskConfig =>
	({
		slug: WEBHOOK_DELIVER_TASK,
		retries: deps.retries,
		inputSchema: [{ name: 'deliveryId', type: 'text', required: true }],
		handler: async ({ input, job, req }) => {
			const { payload } = req
			const deliveryId = (input as { deliveryId: string }).deliveryId
			const delivery = asRow<DeliveryRow>(
				await payload.findByID({
					collection: asSlug(deps.deliveriesSlug),
					id: deliveryId,
					overrideAccess: true,
					req,
				})
			)
			const subscription = await resolveSubscriptionById({
				id: String(delivery.subscriptionId),
				codeSubscriptions: deps.codeSubscriptions,
				subscriptionsSlug: deps.subscriptionsSlug,
				payload,
				req,
			})
			// Includes an undecryptable secret: retrying cannot fix a key problem, so the row dies
			// here rather than throwing, and is never POSTed unsigned.
			const decision = decideDelivery(subscription)
			if (!decision.deliverable) {
				await payload.update({
					collection: asSlug(deps.deliveriesSlug),
					id: deliveryId,
					data: { status: 'dead', error: decision.reason },
					overrideAccess: true,
					req,
				})
				return { output: {} }
			}

			const attempt = Number(job.totalTried ?? 0) + 1
			const result = await sendDelivery({
				subscription: decision.subscription,
				deliveryId,
				event: String(delivery.event),
				body: JSON.stringify(delivery.payload),
				timeoutMs: deps.timeoutMs,
				now: Date.now(),
			})
			const status = deriveDeliveryStatus({ ok: result.ok, attempt, maxRetries: deps.retries })
			await payload.update({
				collection: asSlug(deps.deliveriesSlug),
				id: deliveryId,
				data: {
					status,
					attempt,
					responseStatus: result.responseStatus,
					responseBody: result.responseBody,
					error: result.error,
					durationMs: result.durationMs,
					jobId: String(job.id),
				},
				overrideAccess: true,
				req,
			})
			if (!result.ok) {
				throw new Error(`Webhook delivery failed: ${result.error ?? result.responseStatus}`)
			}
			return { output: {} }
		},
	}) as TaskConfig
