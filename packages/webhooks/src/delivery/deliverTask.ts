import type { CollectionSlug, JsonObject, TaskConfig } from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription, SubscriptionOwnership } from '../options'
import { ANOTHER_OWNER_REASON, madeForAnotherOwner } from '../plugin/owner'
import { decideDelivery, resolveSubscriptionById } from '../plugin/resolveSubscriptions'
import { deriveDeliveryStatus } from './deriveDeliveryStatus'
import type { UrlPolicy } from './destination'
import { sendDelivery } from './sendDelivery'

/** Shared dependencies the delivery task closes over. */
export type DeliverTaskDeps = {
	deliveriesSlug: string
	subscriptionsSlug: string
	codeSubscriptions: CodeSubscription[]
	timeoutMs: number
	retries: number
	urlPolicy: UrlPolicy
	/** Set when `owner` is configured: an attempt is then held to the owner the row was made for. */
	ownership?: SubscriptionOwnership
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
			// The slug is a runtime option, so Payload cannot resolve a document type from it.
			const delivery: JsonObject = await payload.findByID({
				collection: deps.deliveriesSlug as CollectionSlug,
				id: deliveryId,
				overrideAccess: true,
				req,
			})
			const subscription = await resolveSubscriptionById({
				id: String(delivery.subscriptionId),
				source: delivery.subscriptionSource,
				codeSubscriptions: deps.codeSubscriptions,
				subscriptionsSlug: deps.subscriptionsSlug,
				payload,
				req,
			})
			// Includes an undecryptable secret: retrying cannot fix a key problem, so the row dies
			// here rather than throwing, and is never POSTed unsigned.
			const decision = decideDelivery(subscription, deps.urlPolicy)
			if (!decision.deliverable) {
				await payload.update({
					collection: deps.deliveriesSlug as CollectionSlug,
					id: deliveryId,
					data: { status: 'dead', error: decision.reason },
					overrideAccess: true,
					req,
				})
				return { output: {} }
			}
			// Between the write that queued this and the attempt running, or between two attempts, the
			// subscription may have been handed to another owner. The body is the previous owner's view.
			if (
				await madeForAnotherOwner({
					ownership: deps.ownership,
					subscription: decision.subscription,
					row: delivery,
					req,
				})
			) {
				await payload.update({
					collection: deps.deliveriesSlug as CollectionSlug,
					id: deliveryId,
					data: { status: 'dead', error: ANOTHER_OWNER_REASON },
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
				urlPolicy: deps.urlPolicy,
			})
			const status = deriveDeliveryStatus({ ok: result.ok, attempt, maxRetries: deps.retries })
			await payload.update({
				collection: deps.deliveriesSlug as CollectionSlug,
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
