import type { CollectionSlug, JsonObject, TaskConfig } from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import type { CodeSubscription, SubscriptionOwnership } from '../options'
import { actingReq, ownerRefusal } from '../plugin/owner'
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
	/** Re-check, before each attempt, that the owner can still read what the delivery is about. */
	enforceOwnerAccess?: boolean
	/** Event id to the slug of the collection that emits it. */
	eventSources?: Record<string, string>
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
			// On a request of its own. A run works through its jobs concurrently, and Payload isolates only
			// the transaction id of each job's request: `context`, where the window onto sealed secrets
			// is kept, is shared, so the first task to close the window would close it on the others and
			// they would refuse to send. The subscription is committed state, so nothing is lost.
			const subscription = await resolveSubscriptionById({
				id: String(delivery.subscriptionId),
				source: delivery.subscriptionSource,
				codeSubscriptions: deps.codeSubscriptions,
				subscriptionsSlug: deps.subscriptionsSlug,
				payload,
				req: await actingReq(req, { detached: true }),
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
			const attempt = Number(job.totalTried ?? 0) + 1
			// Between the write that queued this and the attempt running, or between two attempts, the
			// subscription may have been handed to another owner, or its owner may have lost access to
			// the document. Either way the body is no longer theirs to receive. A check that could not
			// be made is a failed attempt, not a refusal, so the job's retries still apply to it.
			let refusal: string | null
			try {
				refusal = await ownerRefusal({
					ownership: deps.ownership,
					enforce: deps.enforceOwnerAccess ?? false,
					subscription: decision.subscription,
					row: delivery,
					eventSources: deps.eventSources ?? {},
					req,
				})
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				await payload.update({
					collection: deps.deliveriesSlug as CollectionSlug,
					id: deliveryId,
					data: {
						status: deriveDeliveryStatus({ ok: false, attempt, maxRetries: deps.retries }),
						attempt,
						error: `the owner's access could not be checked, so it was not sent: ${message}`,
						jobId: String(job.id),
					},
					overrideAccess: true,
					req,
				})
				throw err
			}
			if (refusal) {
				await payload.update({
					collection: deps.deliveriesSlug as CollectionSlug,
					id: deliveryId,
					data: { status: 'dead', error: refusal },
					overrideAccess: true,
					req,
				})
				return { output: {} }
			}

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
