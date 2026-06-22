import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import { SECRET_REVEAL_CONTEXT, WEBHOOK_DELIVER_TASK } from '../constants'
import { buildPayload } from '../delivery/buildPayload'
import { sendDelivery } from '../delivery/sendDelivery'
import type { CodeSubscription, CollectionWebhookConfig, WebhookOperation } from '../options'
import {
	fromCodeSubscription,
	fromCollectionRow,
	matchSubscriptions,
	type ResolvedSubscription,
} from '../plugin/resolveSubscriptions'
import { eventId } from './eventTypes'

/** Per-collection dispatch dependencies. */
export type WebhookDispatchDeps = {
	collectionSlug: string
	config: CollectionWebhookConfig
	operations: WebhookOperation[]
	deliveriesSlug: string
	subscriptionsSlug: string
	codeSubscriptions: CodeSubscription[]
	mode: 'queue' | 'inline'
	timeoutMs: number
	queue: string
}

/** Max collection subscriptions scanned per event (pagination is a future enhancement). */
const SUBSCRIPTION_SCAN_LIMIT = 1_000

const resolveListening = async (args: {
	deps: WebhookDispatchDeps
	event: string
	req: PayloadRequest
}): Promise<ResolvedSubscription[]> => {
	const code = args.deps.codeSubscriptions.map(fromCodeSubscription)
	args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = true
	let res: Awaited<ReturnType<typeof args.req.payload.find>>
	try {
		res = await args.req.payload.find({
			collection: args.deps.subscriptionsSlug,
			where: { enabled: { not_equals: false } },
			limit: SUBSCRIPTION_SCAN_LIMIT,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
	} finally {
		args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = false
	}
	if (res.docs.length >= SUBSCRIPTION_SCAN_LIMIT) {
		args.req.payload.logger.warn(
			`@10x-media/webhooks: subscription scan hit the ${SUBSCRIPTION_SCAN_LIMIT} cap; some subscriptions may be skipped for ${args.event}.`
		)
	}
	const collection = res.docs.map((d) =>
		fromCollectionRow(d as Parameters<typeof fromCollectionRow>[0])
	)
	return matchSubscriptions([...code, ...collection], args.event)
}

const dispatch = async (args: {
	deps: WebhookDispatchDeps
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	req: PayloadRequest
}): Promise<void> => {
	const { deps, operation, doc, previousDoc, req } = args
	if (!deps.operations.includes(operation)) {
		return
	}
	const { payload } = req
	const event = eventId(deps.collectionSlug, operation)
	const subscriptions = await resolveListening({ deps, event, req })
	if (!subscriptions.length) {
		return
	}

	const occurredAt = new Date().toISOString()
	for (const subscription of subscriptions) {
		const created = await payload.create({
			collection: deps.deliveriesSlug,
			data: {
				subscriptionId: subscription.id,
				endpoint: subscription.url,
				event,
				status: 'pending',
				attempt: 0,
			},
			overrideAccess: true,
			req,
		})
		const deliveryId = String(created.id)
		const body = buildPayload({
			deliveryId,
			collection: deps.collectionSlug,
			operation,
			doc,
			previousDoc,
			occurredAt,
			config: deps.config,
			req,
		})
		await payload.update({
			collection: deps.deliveriesSlug,
			id: deliveryId,
			data: { payload: body },
			overrideAccess: true,
			req,
		})

		if (deps.mode === 'queue') {
			await payload.jobs.queue({
				task: WEBHOOK_DELIVER_TASK,
				input: { deliveryId },
				queue: deps.queue,
			})
			continue
		}

		// best-effort: a delivery failure must never abort the caller's write
		try {
			const result = await sendDelivery({
				subscription,
				deliveryId,
				event,
				body: JSON.stringify(body),
				timeoutMs: deps.timeoutMs,
				now: Date.now(),
			})
			await payload.update({
				collection: deps.deliveriesSlug,
				id: deliveryId,
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
		} catch (err) {
			payload.logger.error(
				`@10x-media/webhooks: inline delivery ${deliveryId} threw: ${err instanceof Error ? err.message : String(err)}`
			)
		}
	}
}

/** afterChange hook factory for an opt-in source collection. */
export const makeAfterChange =
	(deps: WebhookDispatchDeps): CollectionAfterChangeHook =>
	async ({ doc, previousDoc, operation, req }) => {
		const op: WebhookOperation = operation === 'create' ? 'create' : 'update'
		await dispatch({ deps, operation: op, doc, previousDoc, req })
		return doc
	}

/** afterDelete hook factory for an opt-in source collection. */
export const makeAfterDelete =
	(deps: WebhookDispatchDeps): CollectionAfterDeleteHook =>
	async ({ doc, req }) => {
		await dispatch({ deps, operation: 'delete', doc: doc as Record<string, unknown>, req })
		return doc
	}
