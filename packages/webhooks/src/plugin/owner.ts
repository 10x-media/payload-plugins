import {
	type CollectionSlug,
	createLocalReq,
	executeAccess,
	Forbidden,
	type JsonObject,
	type PayloadRequest,
	type TypedUser,
} from 'payload'

import type {
	OwnerUser,
	SubscriptionOwner,
	SubscriptionOwnership,
	WebhookSubscriptionInfo,
} from '../options'
import { type ResolvedSubscription, subscriptionInfo } from './resolveSubscriptions'

const GLOBAL: SubscriptionOwner = { global: true }

/** Where a request keeps the owners it has already resolved. */
const OWNER_MEMO_CONTEXT = 'webhooksOwnerMemo'

/**
 * A fresh request for a check made on someone's behalf.
 *
 * Payload's `createLocalReq` writes `user` onto whatever request it is handed, so reusing the
 * live request with another user would re-authenticate the caller's own write. The fresh one
 * carries no headers or cookies and an empty context, because the owner is not the caller:
 * a flag the writer's request was given (an internal job marking itself privileged, another
 * dispatch's open window onto sealed fields) must not widen what the owner is shown.
 *
 * Unless `detached`, it joins the caller's transaction, so a read as the owner sees the document
 * the write has not committed yet. It joins without the power to end it. Payload rolls a
 * transaction back when an operation on it throws, and reports nothing to whoever else is using
 * it, so the caller's write would vanish while its API call returned success. Payload skips that
 * rollback for a transaction id that is still a promise, and both database adapters await one,
 * so the id is handed over as a promise: the read happens inside the transaction, and a throw
 * from an access function or a read hook stays a failed read.
 *
 * `detached` is for reads of committed state, which is everything but the document being written.
 */
export const actingReq = (
	req: PayloadRequest,
	options: { detached?: boolean; user?: OwnerUser | null } = {}
): Promise<PayloadRequest> =>
	createLocalReq(
		{
			req: {
				context: {},
				fallbackLocale: req.fallbackLocale,
				i18n: req.i18n,
				locale: req.locale,
				transactionID:
					options.detached || req.transactionID === undefined
						? undefined
						: Promise.resolve(req.transactionID),
			},
			user: (options.user ?? undefined) as TypedUser | undefined,
		},
		req.payload
	)

/**
 * Who a subscription acts as, asked of the application. A code subscription lives in the config
 * file, which is as trusted as the plugin, so it is global without asking. A resolver that
 * throws, or returns a user with no id, is read as "no owner", which every caller treats as a
 * denial.
 *
 * The resolver is handed a request of its own, outside the caller's transaction. Payload rolls a
 * transaction back when a Local API call on it throws, even a caught one, so a resolver looking
 * up a user who has since been deleted would otherwise take the write that triggered it down
 * with it. An owner is committed state, so nothing is lost by reading it from outside.
 */
export const resolveOwner = async (args: {
	ownership: SubscriptionOwnership
	subscription: WebhookSubscriptionInfo
	req: PayloadRequest
}): Promise<SubscriptionOwner | null> => {
	if (args.subscription.source === 'code') {
		return GLOBAL
	}
	let resolved: SubscriptionOwner | null
	try {
		resolved = await args.ownership.resolve({
			subscription: args.subscription,
			req: await actingReq(args.req, { detached: true, user: args.req.user as OwnerUser | null }),
		})
	} catch (err) {
		args.req.payload.logger.error(
			`@10x-media/webhooks: owner.resolve threw for subscription ${args.subscription.id}, so it is treated as having no owner: ${err instanceof Error ? err.message : String(err)}`
		)
		return null
	}
	if (!resolved) {
		return null
	}
	if (resolved.global) {
		return GLOBAL
	}
	const { user } = resolved
	if (user?.id === undefined || user.id === null) {
		return null
	}
	return {
		user: user.collection ? user : { ...user, collection: args.req.payload.config.admin.user },
	}
}

/** Whether two resolved owners are the same principal. Two unresolved owners are the same nobody. */
export const sameOwner = (a: SubscriptionOwner | null, b: SubscriptionOwner | null): boolean => {
	if (!a || !b) {
		return a === b
	}
	if (a.global || b.global) {
		return Boolean(a.global) === Boolean(b.global)
	}
	return (
		String(a.user.id) === String(b.user.id) &&
		String(a.user.collection ?? '') === String(b.user.collection ?? '')
	)
}

/** What a delivery row records about who it was made for. Nothing for a global owner. */
export const ownerStamp = (
	owner: SubscriptionOwner | null
): { ownerCollection?: string; ownerId?: string } =>
	owner && !owner.global
		? { ownerId: String(owner.user.id), ownerCollection: String(owner.user.collection ?? '') }
		: {}

const ownerKey = (owner: SubscriptionOwner): string => {
	const stamp = ownerStamp(owner)
	return owner.global ? 'global' : `${stamp.ownerCollection}:${stamp.ownerId}`
}

/**
 * Whether the caller may save a subscription that acts as `owner`.
 *
 * Naming an owner is a request to receive that owner's documents, so it is authenticated, not
 * trusted. `trusted` is server code: a Local API call with no user on it, which may name anyone.
 * It is the caller's to establish, because having no user is not enough: an anonymous REST or
 * GraphQL request has none either. Everyone else may only act as themselves, and never as the
 * global owner, unless the application's `canActAs` says otherwise.
 */
export const canActAsOwner = async (args: {
	ownership: SubscriptionOwnership
	owner: SubscriptionOwner
	req: PayloadRequest
	trusted: boolean
}): Promise<boolean> => {
	const { owner, ownership, req } = args
	if (args.trusted) {
		return true
	}
	if (ownership.canActAs) {
		return Boolean(await ownership.canActAs({ owner, req }))
	}
	if (!req.user) {
		return false
	}
	return sameOwner(owner, { user: { id: req.user.id, collection: req.user.collection } })
}

/**
 * Whether `user` may read `collection` at all, by the collection's own read access. A `Where`
 * result counts: the user can read some of its documents, which is what subscribing asks. Which
 * documents is decided per document at dispatch.
 */
export const canReadCollection = async (args: {
	req: PayloadRequest
	collection: string
	user: OwnerUser
}): Promise<boolean> => {
	const access = args.req.payload.collections[args.collection as CollectionSlug]?.config.access.read
	// A sanitized collection always has one, so none means the slug is not a collection at all.
	if (!access) {
		return false
	}
	try {
		return Boolean(
			await executeAccess(
				{
					disableErrors: true,
					req: await actingReq(args.req, { detached: true, user: args.user }),
				},
				access
			)
		)
	} catch {
		return false
	}
}

/**
 * The document as `user` reads it, or null when they cannot. Payload's own find with access
 * control on, so collection access (boolean or `Where`), field-level read access and anything a
 * tenant plugin adds to the collection all apply exactly as they do over REST. Depth 0: a
 * populated relationship would carry other documents along. Trashed documents are included, so
 * the update that trashes one is still readable by whoever may read the trash. `draft` asks for
 * the latest version on a collection with drafts, which is the one a draft save just wrote; the
 * main document still holds the last published content at that point.
 *
 * `disableErrors` turns a flat `false` from read access into an empty result. Anything else that
 * throws here (an access function, a read hook) is caught below and read as a denial, and cannot
 * touch the write: see `actingReq`.
 */
const readAsOwner = async (args: {
	req: PayloadRequest
	collection: string
	id: number | string
	user: OwnerUser
	detached?: boolean
}): Promise<Record<string, unknown> | null> => {
	try {
		const res = await args.req.payload.find({
			collection: args.collection as CollectionSlug,
			where: { id: { equals: args.id } },
			limit: 1,
			depth: 0,
			pagination: false,
			overrideAccess: false,
			disableErrors: true,
			draft: true,
			trash: true,
			req: await actingReq(args.req, { detached: args.detached, user: args.user }),
		})
		const docs: JsonObject[] = res.docs
		return docs[0] ?? null
	} catch (err) {
		if (!(err instanceof Forbidden)) {
			args.req.payload.logger.error(
				`@10x-media/webhooks: reading ${args.collection} ${String(args.id)} as a subscription owner failed, so nothing was delivered on its behalf: ${err instanceof Error ? err.message : String(err)}`
			)
		}
		return null
	}
}

type OwnerMemo = Map<string, { at: number; owner: Promise<SubscriptionOwner | null> }>

/**
 * How long a resolved owner is reused on one request. Long enough to cover a bulk operation,
 * which is what the memo is for. Short enough that a job working through documents on a single
 * request for minutes does not go on acting on what an owner was allowed when it started.
 */
const OWNER_MEMO_MS = 5_000

/**
 * Resolve a subscription's owner once per request, for a few seconds at a time. Applications
 * back `resolve` with a query of their own, and a write that touches many documents asks about
 * the same subscriptions for each one. `updatedAt` is part of the key, so a subscription edited
 * mid-request is asked about again.
 */
const resolveOwnerOnce = (args: {
	ownership: SubscriptionOwnership
	subscription: ResolvedSubscription
	req: PayloadRequest
}): Promise<SubscriptionOwner | null> => {
	const existing = args.req.context[OWNER_MEMO_CONTEXT] as OwnerMemo | undefined
	const memo: OwnerMemo = existing ?? new Map()
	args.req.context[OWNER_MEMO_CONTEXT] = memo
	const key = `${args.subscription.source}:${args.subscription.id}:${String(args.subscription.record.updatedAt ?? '')}`
	const now = Date.now()
	const cached = memo.get(key)
	if (cached && now - cached.at < OWNER_MEMO_MS) {
		return cached.owner
	}
	const owner = resolveOwner({
		ownership: args.ownership,
		subscription: subscriptionInfo(args.subscription),
		req: args.req,
	})
	memo.set(key, { at: now, owner })
	return owner
}

/** Whether a subscription may be sent a document, who it acts as, and their view of it. */
export type DeliveryAuthorization =
	| { allowed: false }
	| { allowed: true; doc?: Record<string, unknown>; owner: SubscriptionOwner | null }

/** One dispatch's reads of the document, by owner, so each distinct owner is asked once. */
export type OwnerReads = Map<string, Promise<Record<string, unknown> | null>>

const DENIED: DeliveryAuthorization = { allowed: false }

/**
 * The dispatch-time guard.
 *
 * Without `owner` configured everything is allowed and nothing is asked. With it, the owner is
 * resolved so the delivery row can record it. With enforcement on top: a global owner is allowed,
 * a subscription with no resolvable owner is not (a misconfigured resolver fails closed), and a
 * user-bound one is allowed only when Payload's read access for the source collection, evaluated
 * as that user, still returns the document. What it returns is handed back as `doc`.
 */
export const authorizeDelivery = async (args: {
	ownership: SubscriptionOwnership | undefined
	enforce: boolean
	subscription: ResolvedSubscription
	req: PayloadRequest
	collection: string
	id: number | string
	reads: OwnerReads
	detached?: boolean
}): Promise<DeliveryAuthorization> => {
	if (!args.ownership) {
		return { allowed: true, owner: null }
	}
	const owner = await resolveOwnerOnce({
		ownership: args.ownership,
		subscription: args.subscription,
		req: args.req,
	})
	if (!args.enforce) {
		return { allowed: true, owner }
	}
	if (!owner) {
		args.req.payload.logger.warn(
			`@10x-media/webhooks: subscription ${args.subscription.id} has no resolvable owner, so ${args.collection} ${String(args.id)} was not delivered to it.`
		)
		return DENIED
	}
	if (owner.global) {
		return { allowed: true, owner }
	}
	const key = ownerKey(owner)
	let pending = args.reads.get(key)
	if (!pending) {
		pending = readAsOwner({
			req: args.req,
			collection: args.collection,
			id: args.id,
			user: owner.user,
			detached: args.detached,
		})
		args.reads.set(key, pending)
	}
	const doc = await pending
	return doc ? { allowed: true, owner, doc } : DENIED
}

/**
 * Whether a stored delivery was made for a different owner than its subscription acts as now.
 *
 * The body of an owner-bound delivery is that owner's view of the document. If the subscription
 * has since been handed to someone else, sending it (a replay, or a queued attempt that had not
 * run yet) would give the previous owner's view to the new one. A row with no owner recorded,
 * made before `owner` was configured or for a global subscription, counts as made for nobody.
 */
export const madeForAnotherOwner = async (args: {
	ownership: SubscriptionOwnership | undefined
	subscription: ResolvedSubscription | null
	row: Record<string, unknown>
	req: PayloadRequest
}): Promise<boolean> => {
	if (!args.ownership || !args.subscription) {
		return false
	}
	const now = ownerStamp(
		await resolveOwner({
			ownership: args.ownership,
			subscription: subscriptionInfo(args.subscription),
			req: args.req,
		})
	)
	return (
		(now.ownerId ?? '') !== String(args.row.ownerId ?? '') ||
		(now.ownerCollection ?? '') !== String(args.row.ownerCollection ?? '')
	)
}

/** What a delivery refused for that reason records. */
export const ANOTHER_OWNER_REASON =
	'the subscription acts as a different owner than this delivery was made for (it changed owner, or the delivery predates ownership), so it was not sent'
