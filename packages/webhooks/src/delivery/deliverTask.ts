import type { TaskConfig } from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription } from '../options'
import { resolveSubscriptionById } from '../plugin/resolveSubscriptions'
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
			const delivery = await payload.findByID({
				collection: deps.deliveriesSlug,
				id: deliveryId,
				overrideAccess: true,
				req,
			})
			const subscription = await resolveSubscriptionById({
				id: String(delivery.subscriptionId),
				codeSubscriptions: deps.codeSubscriptions,
				subscriptionsSlug: deps.subscriptionsSlug,
				payload,
				req,
			})
			if (!subscription) {
				await payload.update({
					collection: deps.deliveriesSlug,
					id: deliveryId,
					data: { status: 'dead', error: 'subscription not found' },
					overrideAccess: true,
					req,
				})
				return { output: {} }
			}

			const attempt = Number(job.totalTried ?? 0) + 1
			const result = await sendDelivery({
				subscription,
				deliveryId,
				event: String(delivery.event),
				body: JSON.stringify(delivery.payload),
				timeoutMs: deps.timeoutMs,
				now: Date.now(),
			})
			const status = deriveDeliveryStatus({ ok: result.ok, attempt, maxRetries: deps.retries })
			await payload.update({
				collection: deps.deliveriesSlug,
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
