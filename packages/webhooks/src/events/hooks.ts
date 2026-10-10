import { withRawEncrypted } from '@10x-media/fields/encrypted'
import type {
	CollectionAfterChangeHook,
	CollectionAfterDeleteHook,
	CollectionSlug,
	JsonObject,
	Payload,
	PayloadRequest,
	SanitizedCollectionConfig,
	Where,
} from 'payload'
import { hasAutosaveEnabled } from 'payload/shared'

import { WEBHOOK_DELIVER_TASK } from '../constants'
import { buildPayload, type WebhookBody } from '../delivery/buildPayload'
import type { UrlPolicy } from '../delivery/destination'
import { messageId, sendDelivery } from '../delivery/sendDelivery'
import type { CodeSubscription, CollectionWebhookConfig, WebhookOperation } from '../options'
import {
	decideDelivery,
	fromCodeSubscription,
	matchSubscriptions,
	type ResolvedSubscription,
	resolveCollectionRow,
	type SubscriptionRow,
	subscriptionInfo,
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
	urlPolicy: UrlPolicy
	/** Trims the delivery log when a retention window is configured. Cheap to call every time. */
	prune?: (payload: Payload) => void
}

/** Collection subscriptions read per query while walking the listeners for one event. */
const SUBSCRIPTION_PAGE_SIZE = 100

/**
 * The application's narrowing for this document, if any. A scope that throws falls back to no
 * narrowing: it is a performance dimension, and a broken one must not stop deliveries.
 */
const resolveScope = async (args: {
	deps: WebhookDispatchDeps
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	req: PayloadRequest
}): Promise<Where | null> => {
	const { scope } = args.deps.config
	if (!scope) {
		return null
	}
	try {
		return (
			(await scope({
				doc: args.doc,
				previousDoc: args.previousDoc,
				operation: args.operation,
				req: args.req,
			})) ?? null
		)
	} catch (err) {
		args.req.payload.logger.error(
			`@10x-media/webhooks: scope for ${args.deps.collectionSlug} threw, so every subscription to the event is considered instead: ${err instanceof Error ? err.message : String(err)}`
		)
		return null
	}
}

/**
 * Enabled subscriptions listening for one event: the code-defined ones first, then the
 * collection's, a page at a time, so memory is bounded by the page and not by the install.
 *
 * The event is part of the query rather than a filter applied afterwards, so an install with
 * thousands of subscriptions does not read (and, in `inline` mode, decrypt) every one of them on
 * every watched write. `matchSubscriptions` still runs over the result: it is the authority on
 * what a subscription listens for, and the `where` is only a narrowing.
 *
 * `raw` opens the encrypted window so the rows carry their sealed secrets. `queue` mode and the
 * delete pre-check leave it shut: the task re-resolves each subscription when it runs, and a
 * pre-check never sends, so decrypting would recover plaintext only to throw it away.
 */
export async function* listening(args: {
	deps: WebhookDispatchDeps
	event: string
	req: PayloadRequest
	scope: Where | null
	raw: boolean
}): AsyncGenerator<ResolvedSubscription[]> {
	const { payload } = args.req
	const code = matchSubscriptions(args.deps.codeSubscriptions.map(fromCodeSubscription), args.event)
	if (code.length) {
		yield code
	}
	const where: Where = {
		and: [
			{ enabled: { not_equals: false } },
			{ events: { in: [args.event] } },
			...(args.scope ? [args.scope] : []),
		],
	}
	for (let page = 1; ; page += 1) {
		const read = () =>
			payload.find({
				collection: args.deps.subscriptionsSlug as CollectionSlug,
				where,
				limit: SUBSCRIPTION_PAGE_SIZE,
				page,
				sort: 'id',
				depth: 0,
				overrideAccess: true,
				req: args.req,
			})
		const res = args.raw ? await withRawEncrypted(args.req, () => read()) : await read()
		// `JsonObject` is Payload's own shape for a document whose collection is not statically known,
		// which is the case for every slug this plugin is handed.
		const docs: JsonObject[] = res.docs
		const rows = await withReadableHeaders({
			payload,
			req: args.req,
			rows: docs as SubscriptionRow[],
			subscriptionsSlug: args.deps.subscriptionsSlug,
		})
		const resolved = await Promise.all(
			rows.map((row) =>
				resolveCollectionRow({ payload, row, subscriptionsSlug: args.deps.subscriptionsSlug })
			)
		)
		const matched = matchSubscriptions(resolved, args.event)
		if (matched.length) {
			yield matched
		}
		if (!res.hasNextPage) {
			return
		}
	}
}

/** Whether the application's filter lets this document through to this subscription. */
const passesFilter = async (args: {
	deps: WebhookDispatchDeps
	subscription: ResolvedSubscription
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	req: PayloadRequest
}): Promise<boolean> => {
	const { filter } = args.deps.config
	if (!filter) {
		return true
	}
	try {
		return Boolean(
			await filter({
				doc: args.doc,
				previousDoc: args.previousDoc,
				operation: args.operation,
				subscription: subscriptionInfo(args.subscription),
				req: args.req,
			})
		)
	} catch (err) {
		args.req.payload.logger.error(
			`@10x-media/webhooks: filter for ${args.deps.collectionSlug} threw for subscription ${args.subscription.id}, so nothing was delivered to it: ${err instanceof Error ? err.message : String(err)}`
		)
		return false
	}
}

/**
 * Whether this write is one a receiver should hear about.
 *
 * An autosave never is. On an autosave collection the admin saves a draft every time the editor
 * pauses, so emitting would send a stream of half-typed documents and fill the delivery log; the
 * deliberate save that follows emits on its own. The flag only exists on the request's query,
 * which is where the admin sets it.
 *
 * The first of those saves carries no flag at all. Opening "Create new" on an autosave collection
 * makes the admin create the document there and then, as an empty draft, through the Local API on
 * the signed-in user's request. That is what is skipped: a draft create on an autosave collection,
 * made through the Local API with a user. The document's first deliberate save then arrives as an
 * `updated`. A create over REST or GraphQL, and a Local API create with no user (an import, a
 * seed), are deliberate and emit. Application code that creates such a draft through the Local
 * API on a user's behalf is indistinguishable from the admin's and is skipped with it.
 *
 * A deliberate save that leaves the document a draft emits unless the collection opted out. It is
 * the default because an unpublish is such a save, and a receiver mirroring published content has
 * to hear about that one.
 */
const shouldEmit = (args: {
	collection?: SanitizedCollectionConfig
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
	if (
		args.operation === 'create' &&
		args.doc._status === 'draft' &&
		args.req.payloadAPI === 'local' &&
		args.req.user &&
		args.collection &&
		hasAutosaveEnabled(args.collection)
	) {
		return false
	}
	return args.config.includeDrafts !== false || args.doc._status !== 'draft'
}

const dispatch = async (args: {
	collection?: SanitizedCollectionConfig
	deps: WebhookDispatchDeps
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	req: PayloadRequest
}): Promise<void> => {
	const { collection, deps, operation, doc, previousDoc, req } = args
	if (
		!deps.operations.includes(operation) ||
		!shouldEmit({ collection, config: deps.config, doc, operation, req })
	) {
		return
	}
	const { payload } = req
	const event = eventId(deps.collectionSlug, operation)
	const occurredAt = new Date().toISOString()
	const scope = await resolveScope({ deps, operation, doc, previousDoc, req })
	// Built once, before the first delivery row exists. The consumer's `transform` runs in here, and
	// it is the likeliest thing in this function to throw: failing then leaves nothing half-written.
	// Each delivery only stamps its own id onto the result.
	let template: WebhookBody | undefined
	const inline: { body: string; deliveryId: string; subscription: ResolvedSubscription }[] = []
	for await (const page of listening({ deps, event, req, scope, raw: deps.mode === 'inline' })) {
		for (const subscription of page) {
			if (!(await passesFilter({ deps, subscription, operation, doc, previousDoc, req }))) {
				continue
			}
			template ??= buildPayload({
				deliveryId: '',
				collection: deps.collectionSlug,
				operation,
				doc,
				previousDoc,
				occurredAt,
				config: deps.config,
				req,
			})
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
			const body = { ...template, id: messageId(deliveryId) }
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

			const decision = decideDelivery(subscription, deps.urlPolicy)
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
			// ponytail: inline sends for one write are held in memory and fired together. Fine for the
			// handful of receivers inline mode is for; an install with hundreds per event wants `queue`.
			inline.push({ body: JSON.stringify(body), deliveryId, subscription })
		}
	}

	// The sends go out together, so the write waits for the slowest receiver rather than for every
	// receiver in turn: five that each run to the timeout cost one timeout, not five. Only the
	// network calls are concurrent. The results are written one at a time below, because the
	// write's transaction is a single session and does not take concurrent operations.
	const sent = await Promise.all(
		inline.map(async ({ body, deliveryId, subscription }) => {
			try {
				return await sendDelivery({
					subscription,
					deliveryId,
					event,
					body,
					timeoutMs: deps.timeoutMs,
					now: Date.now(),
					urlPolicy: deps.urlPolicy,
				})
			} catch (err) {
				// Recorded as the failed attempt it is, so the row ends `dead` with the reason
				// rather than sitting `pending` with nothing left to send it.
				return { ok: false, error: err instanceof Error ? err.message : String(err), durationMs: 0 }
			}
		})
	)
	for (const [index, { deliveryId }] of inline.entries()) {
		const result = sent[index]
		if (!result) {
			continue
		}
		// best-effort: a delivery failure must never abort the caller's write
		try {
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
	args.deps.prune?.(args.req.payload)
}

/** afterChange hook factory for an opt-in source collection. */
export const makeAfterChange =
	(deps: WebhookDispatchDeps): CollectionAfterChangeHook =>
	async ({ collection, doc, previousDoc, operation, req }) => {
		const op: WebhookOperation = operation === 'create' ? 'create' : 'update'
		await dispatchSafely({ collection, deps, operation: op, doc, previousDoc, req })
		return doc
	}

/** afterDelete hook factory for an opt-in source collection. */
export const makeAfterDelete =
	(deps: WebhookDispatchDeps): CollectionAfterDeleteHook =>
	async ({ doc, req }) => {
		await dispatchSafely({ deps, operation: 'delete', doc: doc as Record<string, unknown>, req })
		return doc
	}
