import { withRawEncrypted } from '@10x-media/fields/encrypted'
import type {
	CollectionAfterChangeHook,
	CollectionAfterDeleteHook,
	CollectionSlug,
	JsonObject,
	PayloadRequest,
} from 'payload'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import { buildPayload } from '../delivery/buildPayload'
import { sendDelivery } from '../delivery/sendDelivery'
import type { CodeSubscription, CollectionWebhookConfig, WebhookOperation } from '../options'
import {
	decideDelivery,
	fromCodeSubscription,
	matchSubscriptions,
	type ResolvedSubscription,
	resolveCollectionRow,
	type SubscriptionRow,
	withReadableHeaders,
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

/**
 * Enabled collection subscriptions listening for one event, plus the code-defined ones.
 *
 * The event is part of the query rather than a filter applied afterwards, so an install with
 * hundreds of subscriptions does not read (and, in `inline` mode, decrypt) every one of them on
 * every watched write. `matchSubscriptions` still runs over the result: it is the authority on
 * what a subscription listens for, and the `where` is only a narrowing.
 *
 * In `queue` mode the raw window is skipped entirely. The task re-resolves each subscription when
 * it runs, so decrypting here would recover plaintext only to throw it away; without the window
 * every stored secret reads back as `hidden`, which is exactly what it is at this point.
 */
const resolveListening = async (args: {
	deps: WebhookDispatchDeps
	event: string
	req: PayloadRequest
}): Promise<ResolvedSubscription[]> => {
	const { payload } = args.req
	const code = args.deps.codeSubscriptions.map(fromCodeSubscription)
	const read = () =>
		payload.find({
			collection: args.deps.subscriptionsSlug as CollectionSlug,
			where: {
				and: [{ enabled: { not_equals: false } }, { events: { in: [args.event] } }],
			},
			limit: SUBSCRIPTION_SCAN_LIMIT,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
	const res =
		args.deps.mode === 'queue' ? await read() : await withRawEncrypted(args.req, () => read())
	if (res.docs.length >= SUBSCRIPTION_SCAN_LIMIT) {
		payload.logger.warn(
			`@10x-media/webhooks: subscription scan hit the ${SUBSCRIPTION_SCAN_LIMIT} cap; some subscriptions may be skipped for ${args.event}.`
		)
	}
	// `JsonObject` is Payload's own shape for a document whose collection is not statically known,
	// which is the case for every slug this plugin is handed.
	const docs: JsonObject[] = res.docs
	const rows = await withReadableHeaders({
		payload,
		req: args.req,
		rows: docs as SubscriptionRow[],
		subscriptionsSlug: args.deps.subscriptionsSlug,
	})
	const collection = await Promise.all(
		rows.map((row) =>
			resolveCollectionRow({ payload, row, subscriptionsSlug: args.deps.subscriptionsSlug })
		)
	)
	return matchSubscriptions([...code, ...collection], args.event)
}

/**
 * Whether this write is one a receiver should hear about.
 *
 * An autosave never is. On an autosave collection the admin saves a draft every time the editor
 * pauses, so emitting would send a stream of half-typed documents and fill the delivery log; the
 * deliberate save that follows emits on its own. The flag only exists on the request's query,
 * which is where the admin sets it.
 *
 * A deliberate save that leaves the document a draft emits unless the collection opted out. It is
 * the default because an unpublish is such a save, and a receiver mirroring published content has
 * to hear about that one.
 */
const shouldEmit = (args: {
	config: CollectionWebhookConfig
	doc: Record<string, unknown>
	operation: WebhookOperation
	req: PayloadRequest
}): boolean => {
	if (args.operation === 'delete') {
		return true
	}
	const autosave = args.req.query?.autosave
	if (autosave === true || autosave === 'true') {
		return false
	}
	return args.config.includeDrafts !== false || args.doc._status !== 'draft'
}

const dispatch = async (args: {
	deps: WebhookDispatchDeps
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	req: PayloadRequest
}): Promise<void> => {
	const { deps, operation, doc, previousDoc, req } = args
	if (
		!deps.operations.includes(operation) ||
		!shouldEmit({ config: deps.config, doc, operation, req })
	) {
		return
	}
	const { payload } = req
	const event = eventId(deps.collectionSlug, operation)
	const subscriptions = await resolveListening({ deps, event, req })
	if (!subscriptions.length) {
		return
	}

	// Built once, before any delivery row exists. The consumer's `transform` runs in here, and it
	// is the likeliest thing in this function to throw: failing now leaves nothing half-written.
	// Each delivery then only stamps its own id onto the result.
	const template = buildPayload({
		deliveryId: '',
		collection: deps.collectionSlug,
		operation,
		doc,
		previousDoc,
		occurredAt: new Date().toISOString(),
		config: deps.config,
		req,
	})
	for (const subscription of subscriptions) {
		const created = await payload.create({
			collection: deps.deliveriesSlug as CollectionSlug,
			data: {
				subscriptionId: subscription.id,
				subscriptionSource: subscription.source,
				endpoint: subscription.url,
				event,
				status: 'pending',
				attempt: 0,
			},
			overrideAccess: true,
			req,
		})
		const deliveryId = String(created.id)
		const body = { ...template, id: deliveryId }
		await payload.update({
			collection: deps.deliveriesSlug as CollectionSlug,
			id: deliveryId,
			data: { payload: body },
			overrideAccess: true,
			req,
		})

		if (deps.mode === 'queue') {
			// On the caller's request, like the delivery row above, so the two share a transaction:
			// a write that rolls back takes its job with it, and a runner cannot pick the job up
			// before the row it points at is committed.
			await payload.jobs.queue({
				task: WEBHOOK_DELIVER_TASK,
				input: { deliveryId },
				queue: deps.queue,
				req,
			})
			continue
		}

		const decision = decideDelivery(subscription)
		if (!decision.deliverable) {
			await payload.update({
				collection: deps.deliveriesSlug as CollectionSlug,
				id: deliveryId,
				data: { status: 'dead', error: decision.reason },
				overrideAccess: true,
				req,
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
				collection: deps.deliveriesSlug as CollectionSlug,
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

/**
 * Run a dispatch without letting it fail the write that caused it. A webhook is a side effect of
 * the write, so a `transform` that throws, a delivery row that will not save, or a queue that is
 * down is logged and dropped rather than turned into a failed save for the editor.
 *
 * On a SQL adapter a failed statement has already poisoned the surrounding transaction, so there
 * the write still fails; what this guarantees everywhere is that nothing thrown from JavaScript,
 * the consumer's `transform` above all, can do it.
 */
const dispatchSafely = async (args: Parameters<typeof dispatch>[0]): Promise<void> => {
	try {
		await dispatch(args)
	} catch (err) {
		args.req.payload.logger.error(
			`@10x-media/webhooks: dispatching ${eventId(args.deps.collectionSlug, args.operation)} failed, so no webhook was sent for this write: ${err instanceof Error ? err.message : String(err)}`
		)
	}
}

/** afterChange hook factory for an opt-in source collection. */
export const makeAfterChange =
	(deps: WebhookDispatchDeps): CollectionAfterChangeHook =>
	async ({ doc, previousDoc, operation, req }) => {
		const op: WebhookOperation = operation === 'create' ? 'create' : 'update'
		await dispatchSafely({ deps, operation: op, doc, previousDoc, req })
		return doc
	}

/** afterDelete hook factory for an opt-in source collection. */
export const makeAfterDelete =
	(deps: WebhookDispatchDeps): CollectionAfterDeleteHook =>
	async ({ doc, req }) => {
		await dispatchSafely({ deps, operation: 'delete', doc: doc as Record<string, unknown>, req })
		return doc
	}
