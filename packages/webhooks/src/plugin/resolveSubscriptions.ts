import type { Payload, PayloadRequest } from 'payload'

import { SECRET_MASK, SECRET_REVEAL_CONTEXT, SECRET_UNUSABLE } from '../constants'
import type { CodeSubscription } from '../options'
import { normalizeSecret } from '../secrets/format'

/** A subscription resolved from either source, ready to deliver to. */
export type ResolvedSubscription = {
	id: string
	source: 'collection' | 'code'
	url: string
	events: string[]
	/**
	 * Every secret a delivery must be signed with, active first. Empty with `secretUnusable`
	 * false means the subscription has no secret and is meant to be sent unsigned.
	 */
	secrets: string[]
	/**
	 * The *active* secret is configured but could not be recovered, so this subscription must not
	 * be delivered at all. Falling back to an unsigned POST would be accepted by any receiver that
	 * verifies only when a signature header is present.
	 */
	secretUnusable: boolean
	/**
	 * A retired secret inside its rotation grace window could not be recovered and was dropped.
	 * The delivery still goes out, signed with the active secret: refusing here would trade a
	 * correctly signed delivery for none at all, which is worse on every axis. Receivers that have
	 * not yet moved off the retired secret lose their overlap early.
	 */
	retiredSecretUnusable: boolean
	headers?: Record<string, string>
	enabled: boolean
}

/** One stored secret value sorted into a usable key, a hard failure, or nothing at all. */
type SecretSlot = { secret: string | null; unusable: boolean }

/**
 * Classify one stored secret value.
 *
 * `SECRET_UNUSABLE` and a value that will not normalize both mean a secret exists that cannot
 * sign. The mask is different: it means this read never opened a reveal window, so it carries no
 * information about whether a secret is usable and is skipped without raising the flag.
 */
const resolveSlot = (value: string | Date | null | undefined): SecretSlot => {
	if (typeof value !== 'string' || value === '' || value === SECRET_MASK) {
		return { secret: null, unusable: false }
	}
	if (value === SECRET_UNUSABLE) {
		return { secret: null, unusable: true }
	}
	try {
		return { secret: normalizeSecret(value), unusable: false }
	} catch {
		return { secret: null, unusable: true }
	}
}

/**
 * Resolve both secret slots, keeping their failures apart. Which slot failed decides what happens:
 * an unusable *active* secret means the signature the receiver expects cannot be produced at all
 * and the delivery is refused, while an unusable *retired* one only costs the rotation overlap.
 * Collapsing the two would let a stale, unreadable retired secret block deliveries that the
 * current secret can sign perfectly well.
 */
const resolveSecrets = (args: {
	active: string | Date | null | undefined
	retired?: string | Date | null | undefined
}): Pick<ResolvedSubscription, 'retiredSecretUnusable' | 'secrets' | 'secretUnusable'> => {
	const active = resolveSlot(args.active)
	const retired = resolveSlot(args.retired)
	return {
		secrets: [active.secret, retired.secret].filter((s): s is string => s !== null),
		secretUnusable: active.unusable,
		retiredSecretUnusable: retired.unusable,
	}
}

const rowHeaders = (
	headers?: { key?: string | null; value?: string | null }[] | null
): Record<string, string> | undefined => {
	if (!headers?.length) {
		return undefined
	}
	const out: Record<string, string> = {}
	for (const h of headers) {
		if (h.key) {
			out[h.key] = h.value ?? ''
		}
	}
	return Object.keys(out).length ? out : undefined
}

/**
 * Whether a rotated-out secret is still inside its grace window. Expiry is decided here, at
 * resolve time, rather than by a scheduled job: the stored timestamp is the whole state, so the
 * window is correct across restarts and the old secret stops signing the moment it lapses.
 */
const withinGrace = (expiresAt: string | Date | null | undefined, now: number): boolean => {
	if (!expiresAt) {
		return false
	}
	const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt)
	return Number.isFinite(expires) && now < expires
}

/** Normalize a subscriptions-collection document. */
export const fromCollectionRow = (
	row: {
		id: string | number
		url: string
		events?: string[] | null
		secret?: string | null
		previousSecret?: string | null
		previousSecretExpiresAt?: string | Date | null
		headers?: { key?: string | null; value?: string | null }[] | null
		enabled?: boolean | null
	},
	now = Date.now()
): ResolvedSubscription => ({
	id: String(row.id),
	source: 'collection',
	url: row.url,
	events: row.events ?? [],
	...resolveSecrets({
		active: row.secret,
		retired: withinGrace(row.previousSecretExpiresAt, now) ? row.previousSecret : undefined,
	}),
	headers: rowHeaders(row.headers),
	enabled: row.enabled !== false,
})

/** Normalize a code-defined subscription. */
export const fromCodeSubscription = (sub: CodeSubscription): ResolvedSubscription => ({
	id: sub.id,
	source: 'code',
	url: sub.url,
	events: sub.events,
	...resolveSecrets({ active: sub.secret }),
	headers: sub.headers,
	enabled: sub.enabled !== false,
})

export type DeliveryDecision =
	| { deliverable: false; reason: string }
	| { deliverable: true; subscription: ResolvedSubscription }

/**
 * Whether a resolved subscription may be delivered to, and why not when it may not. An
 * unrecoverable *active* secret is a refusal rather than a downgrade to unsigned: a receiver that
 * verifies only when a signature header is present would accept an unsigned delivery
 * unconditionally. An unrecoverable *retired* secret is not a refusal, because the delivery can
 * still be signed with the active secret, which is strictly better than not delivering.
 */
export const decideDelivery = (subscription: ResolvedSubscription | null): DeliveryDecision => {
	if (!subscription) {
		return { deliverable: false, reason: 'subscription not found' }
	}
	if (!subscription.enabled) {
		return { deliverable: false, reason: 'subscription disabled' }
	}
	if (subscription.secretUnusable) {
		return {
			deliverable: false,
			reason: 'signing secret could not be decrypted; refused rather than sent unsigned',
		}
	}
	return { deliverable: true, subscription }
}

/** Enabled subscriptions listening for `event`. */
export const matchSubscriptions = (
	subs: ResolvedSubscription[],
	event: string
): ResolvedSubscription[] => subs.filter((s) => s.enabled && s.events.includes(event))

/** Look up one subscription by id (code first, then the collection). */
export const resolveSubscriptionById = async (args: {
	id: string
	codeSubscriptions: CodeSubscription[]
	subscriptionsSlug: string
	payload: Payload
	req: PayloadRequest
}): Promise<ResolvedSubscription | null> => {
	const code = args.codeSubscriptions.find((s) => s.id === args.id)
	if (code) {
		return fromCodeSubscription(code)
	}
	args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = true
	try {
		const res = await args.payload.find({
			collection: args.subscriptionsSlug,
			where: { id: { equals: args.id } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
		const row = res.docs[0] as Parameters<typeof fromCollectionRow>[0] | undefined
		return row ? fromCollectionRow(row) : null
	} finally {
		args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = false
	}
}
