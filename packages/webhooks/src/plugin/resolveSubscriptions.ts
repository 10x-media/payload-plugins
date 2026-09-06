import { withRawEncrypted } from '@10x-media/fields/encrypted'
import type { CollectionSlug, Payload, PayloadRequest } from 'payload'

import type { CodeSubscription } from '../options'
import { InvalidSecretError, normalizeSecret } from '../secrets/format'
import { recoverSecret } from '../secrets/recover'
import { secretSetName } from '../secrets/secretFields'

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
	/** Why the active secret could not be recovered, phrased as the operator's next step. */
	secretUnusableReason?: string
	/**
	 * A retired secret inside its rotation grace window could not be recovered and was dropped.
	 * The delivery still goes out, signed with the active secret: refusing here would trade a
	 * correctly signed delivery for none at all, which is worse on every axis. Receivers that have
	 * not yet moved off the retired secret lose their overlap early.
	 */
	retiredSecretUnusable: boolean
	/** Why the retired secret was dropped, for the log line that reports the lost overlap. */
	retiredSecretUnusableReason?: string
	/**
	 * A secret is stored but this read never opened the raw window, so the ciphertext was stripped
	 * from the row before it got here. The delivery must be refused rather than sent unsigned: the
	 * alternative turns a missing `withRawEncrypted` in some future call site into silently
	 * unsigned traffic.
	 */
	secretHidden: boolean
	headers?: Record<string, string>
	enabled: boolean
}

/**
 * What one secret value turned out to be.
 *
 * `absent` is the only state that legitimately yields an unsigned delivery. `hidden` is kept
 * apart from it: a hidden value means a secret exists but this read never opened the raw window,
 * so treating it as absent would turn a caller's mistake into an unsigned POST.
 */
export type SecretSlot =
	| { state: 'absent' | 'hidden'; secret: null }
	| { state: 'ok'; secret: string }
	| { reason: string; secret: null; state: 'unusable' }

const ABSENT: SecretSlot = { secret: null, state: 'absent' }

/** Classify a plaintext secret: what a code subscription supplies, already in the clear. */
export const plaintextSlot = (value: unknown): SecretSlot => {
	if (typeof value !== 'string' || value === '') {
		return ABSENT
	}
	try {
		return { secret: normalizeSecret(value), state: 'ok' }
	} catch (err) {
		return {
			reason: err instanceof InvalidSecretError ? err.reason : String(err),
			secret: null,
			state: 'unusable',
		}
	}
}

/** The shape a subscriptions row arrives in, read inside the raw window. */
export type SubscriptionRow = {
	id: string | number
	url: string
	events?: string[] | null
	secret?: string | null
	previousSecret?: string | null
	previousSecretExpiresAt?: string | Date | null
	headers?: { key?: string | null; value?: string | null }[] | null
	enabled?: boolean | null
} & Record<string, unknown>

/**
 * Classify one stored secret field of a row.
 *
 * The set-indicator sibling is what tells an absent secret apart from a stripped one: a normal
 * read removes the ciphertext entirely and leaves the indicator true, which is a caller that
 * forgot the raw window rather than a subscription meant to go out unsigned.
 */
const storedSlot = async (args: {
	payload: Payload
	subscriptionsSlug: string
	path: 'previousSecret' | 'secret'
	row: SubscriptionRow
}): Promise<SecretSlot> => {
	const value = args.row[args.path]
	if (typeof value !== 'string' || value === '') {
		return args.row[secretSetName(args.path)] === true ? { secret: null, state: 'hidden' } : ABSENT
	}
	const recovered = await recoverSecret({
		payload: args.payload,
		path: args.path,
		subscriptionsSlug: args.subscriptionsSlug,
		value,
	})
	return recovered.ok
		? { secret: recovered.secret, state: 'ok' }
		: { reason: recovered.reason, secret: null, state: 'unusable' }
}

/**
 * Fold both secret slots into the delivery-facing flags, keeping their failures apart. Which slot
 * failed decides what happens: an unusable *active* secret means the signature the receiver
 * expects cannot be produced at all and the delivery is refused, while an unusable *retired* one
 * only costs the rotation overlap. Collapsing the two would let a stale, unreadable retired
 * secret block deliveries the current secret can sign perfectly well.
 */
const foldSecrets = (
	active: SecretSlot,
	retired: SecretSlot
): Pick<
	ResolvedSubscription,
	| 'retiredSecretUnusable'
	| 'retiredSecretUnusableReason'
	| 'secretHidden'
	| 'secrets'
	| 'secretUnusable'
	| 'secretUnusableReason'
> => ({
	secrets: [active.secret, retired.secret].filter((s): s is string => s !== null),
	secretUnusable: active.state === 'unusable',
	secretUnusableReason: active.state === 'unusable' ? active.reason : undefined,
	secretHidden: active.state === 'hidden',
	// A hidden retired secret is genuinely uninformative: the active secret already carries the
	// delivery, and the overlap is the only thing at stake.
	retiredSecretUnusable: retired.state === 'unusable',
	retiredSecretUnusableReason: retired.state === 'unusable' ? retired.reason : undefined,
})

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
export const withinGrace = (expiresAt: string | Date | null | undefined, now: number): boolean => {
	if (!expiresAt) {
		return false
	}
	const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt)
	return Number.isFinite(expires) && now < expires
}

/** Assemble a resolved subscription from a row and its already-classified secrets. */
export const fromCollectionRow = (
	row: SubscriptionRow,
	secrets: { active: SecretSlot; retired: SecretSlot }
): ResolvedSubscription => ({
	id: String(row.id),
	source: 'collection',
	url: row.url,
	events: row.events ?? [],
	...foldSecrets(secrets.active, secrets.retired),
	headers: rowHeaders(row.headers),
	enabled: row.enabled !== false,
})

/**
 * Normalize a subscriptions-collection row read inside the raw window, decrypting both secret
 * slots. A retired secret outside its grace window is not decrypted at all: it cannot sign, so
 * recovering it would only be work, and a failure on it would report a lost overlap that had
 * already lapsed.
 */
export const resolveCollectionRow = async (args: {
	payload: Payload
	subscriptionsSlug: string
	row: SubscriptionRow
	now?: number
}): Promise<ResolvedSubscription> => {
	const { payload, row, subscriptionsSlug } = args
	const inGrace = withinGrace(row.previousSecretExpiresAt, args.now ?? Date.now())
	const [active, retired] = await Promise.all([
		storedSlot({ path: 'secret', payload, row, subscriptionsSlug }),
		inGrace
			? storedSlot({ path: 'previousSecret', payload, row, subscriptionsSlug })
			: Promise.resolve(ABSENT),
	])
	// Named, because an install with many subscriptions otherwise gets one error per delivery with
	// nothing in it to say which row needs which fix.
	const subject = `${subscriptionsSlug} ${String(row.id)}`
	if (active.state === 'unusable') {
		payload.logger.error(
			`@10x-media/webhooks: the stored signing secret for ${subject} could not be recovered, so deliveries for this subscription will fail instead of being sent unsigned: ${active.reason}`
		)
	}
	if (retired.state === 'unusable') {
		payload.logger.error(
			`@10x-media/webhooks: the retired signing secret for ${subject}, still inside its rotation grace window, could not be recovered and has been dropped, so receivers that have not moved off it lose their overlap early. Deliveries continue, signed with the current secret. Reason: ${retired.reason}`
		)
	}
	return fromCollectionRow(row, { active, retired })
}

/** Normalize a code-defined subscription. */
export const fromCodeSubscription = (sub: CodeSubscription): ResolvedSubscription => ({
	id: sub.id,
	source: 'code',
	url: sub.url,
	events: sub.events,
	...foldSecrets(plaintextSlot(sub.secret), ABSENT),
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
			reason: `signing secret could not be recovered, so the delivery was refused rather than sent unsigned: ${subscription.secretUnusableReason ?? 'no reason recorded'}`,
		}
	}
	if (subscription.secretHidden) {
		return {
			deliverable: false,
			reason: 'signing secret was not read for signing; refused rather than sent unsigned',
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
	const res = await withRawEncrypted(args.req, () =>
		args.payload.find({
			collection: args.subscriptionsSlug as CollectionSlug,
			where: { id: { equals: args.id } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
	)
	const row = res.docs[0] as SubscriptionRow | undefined
	return row
		? resolveCollectionRow({
				payload: args.payload,
				row,
				subscriptionsSlug: args.subscriptionsSlug,
			})
		: null
}
