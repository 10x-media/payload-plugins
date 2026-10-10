import type { KeysConfig } from '@10x-media/fields/encrypted'
import type { CollectionConfig, CollectionSlug, Field, PayloadRequest, Where } from 'payload'

import {
	DEFAULT_DELIVERY_QUEUE,
	DEFAULT_RETRIES,
	DEFAULT_ROTATION_GRACE_SECONDS,
	DEFAULT_TIMEOUT_MS,
	MAX_ROTATION_GRACE_SECONDS,
} from './constants'
import type { UrlPolicy } from './delivery/destination'
import type { TranslationsOption } from './translations'

export type WebhookOperation = 'create' | 'update' | 'delete'

export type MaybePromise<T> = Promise<T> | T

/**
 * What a `filter` or `owner.resolve` callback is shown of a subscription. `record` is the stored
 * row at depth 0 for an admin-managed subscription, fields added through
 * `subscriptionsCollection.overrides` included, or the config object for a code subscription.
 * The signing secrets and the custom header values are never part of it.
 */
export type WebhookSubscriptionInfo = {
	id: string
	source: 'code' | 'collection'
	url: string
	events: string[]
	record: Record<string, unknown>
}

/**
 * Decide per subscription whether a document is delivered to it. Runs before a delivery row
 * exists, so `false` leaves no record of the document and sends nothing. A filter that throws is
 * logged and counts as `false`.
 *
 * It runs for code subscriptions as well, with `source: 'code'`; return `true` for those to keep
 * a monitoring subscription receiving everything. It is a business rule, not the tenant boundary:
 * `enforceOwnerAccess` is what guarantees a subscription cannot receive what its owner cannot read.
 *
 * `req` is the write's own request. As in any hook, a Local API call made with it that throws
 * rolls the write's transaction back, so pass `disableErrors: true` to a lookup that may miss.
 */
export type SubscriptionFilter = (args: {
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	operation: WebhookOperation
	subscription: WebhookSubscriptionInfo
	req: PayloadRequest
}) => MaybePromise<boolean>

/**
 * Narrow which subscriptions are loaded for a document, with a `Where` over the subscriptions
 * collection that is combined with the plugin's own `enabled` and `events` constraints. A
 * multi-tenant install then reads its own tenant's rows per write instead of every subscriber to
 * the event.
 *
 * A performance dimension, not a boundary, and it cuts both ways: a subscription the `Where`
 * leaves out is never considered, so `or` in the rows that carry no tenant of their own. A scope
 * that throws, or returns a query the subscriptions collection cannot run, is logged and ignored.
 * Code subscriptions are not affected by it.
 */
export type SubscriptionScope = (args: {
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	operation: WebhookOperation
	req: PayloadRequest
}) => MaybePromise<Where | null | undefined>

/**
 * A user whose read access a subscription is evaluated against. Pass the real user document,
 * the thing Payload would put on `req.user`, with its `collection`. Without one the admin
 * collection is assumed, the way Payload's own Local API does.
 */
export type OwnerUser = { id: number | string; collection?: string } & Record<string, unknown>

/**
 * Who a subscription acts as. `{ user }` binds it to that user: it can only subscribe to
 * collections the user can read, and only ever receives documents the user can read, as the user
 * reads them. `{ global: true }` marks trusted infrastructure and skips both checks, which is
 * right for a subscription an operator manages and wrong for anything a tenant can create.
 */
export type SubscriptionOwner = { global: true; user?: never } | { global?: false; user: OwnerUser }

export type SubscriptionOwnership = {
	/**
	 * Called when a subscription is saved and for every candidate subscription at dispatch (once
	 * per subscription per request). `null` means no owner could be determined, which under
	 * `enforceOwnerAccess` rejects the save and skips the delivery. Never return
	 * `{ global: true }` just because an owner field is empty, unless only operators can create
	 * subscriptions. Code subscriptions are always global and never reach this.
	 *
	 * `req` is a request of its own, outside the transaction of the write being dispatched: it
	 * reads committed data, and nothing it does can roll that write back.
	 */
	resolve: (args: {
		subscription: WebhookSubscriptionInfo
		req: PayloadRequest
	}) => MaybePromise<SubscriptionOwner | null>
	/**
	 * Whether the caller may save a subscription that acts as `owner`. Asked on create and whenever
	 * a save changes who the owner is. Without it, a logged-in user may only act as themselves and
	 * never as the global owner. Server code, a Local API call with no user on it, is trusted and
	 * not asked. `req` is a request of the plugin's own carrying the caller's user, not the
	 * caller's request: it has no headers.
	 */
	canActAs?: (args: { owner: SubscriptionOwner; req: PayloadRequest }) => MaybePromise<boolean>
}

export type CollectionWebhookConfig = {
	operations?: WebhookOperation[]
	includePreviousData?: boolean
	/**
	 * Emit for a deliberate save that leaves the document a draft. Default `true`, because an
	 * unpublish is such a save and a receiver mirroring published content has to hear about it;
	 * the body carries `_status`, so a receiver can tell. Set `false` to keep unpublished content
	 * from leaving at all, at the cost of that signal. Autosaves never emit either way, and neither
	 * setting matters on a collection without drafts.
	 */
	includeDrafts?: boolean
	/**
	 * Reshape or redact a document before it is sent. Applied to the body's `data` and,
	 * when `includePreviousData` is set, to `previousData` as well, so redaction cannot
	 * be bypassed through the prior document. `target` names the slot being built; on
	 * the `previousData` call `doc` is the prior document and `previousDoc` is undefined.
	 */
	transform?: (args: {
		doc: Record<string, unknown>
		previousDoc?: Record<string, unknown>
		operation: WebhookOperation
		req: PayloadRequest
		target: 'data' | 'previousData'
	}) => unknown
	/** Decide per subscription whether this document is delivered. See `SubscriptionFilter`. */
	filter?: SubscriptionFilter
	/** Narrow the subscriptions loaded for this document. See `SubscriptionScope`. */
	scope?: SubscriptionScope
}

export type CodeSubscription = {
	id: string
	url: string
	events: string[]
	secret?: string
	headers?: Record<string, string>
	enabled?: boolean
}

export type DeliveryMode = 'auto' | 'queue' | 'inline'

export type DeliveryOptions = {
	mode?: DeliveryMode
	timeoutMs?: number
	retries?: number
	queue?: string
	/**
	 * Hostnames deliveries may be sent to. Unset, no host is ruled out by name. Set, it is an
	 * allowlist: an exact hostname, or `*.example.com` for any subdomain. A subscription for any
	 * other host is rejected on save, a code subscription for one fails at startup, and a row
	 * that already points at one is refused at delivery time. An empty list allows no host at all.
	 * It is independent of `allowPrivateAddresses`: a listed host still has to be public unless
	 * that is on.
	 */
	allowedHosts?: string[]
	/**
	 * Let admin-managed subscriptions point at loopback, private, link-local and other non-public
	 * addresses. Default `false`: a subscription URL is input from whoever may create one, and a
	 * delivery to an internal address is a request made from inside your network on their behalf.
	 * Turn it on for local development, or when receivers are internal and every subscription
	 * author is trusted. Code subscriptions are never held to this.
	 */
	allowPrivateAddresses?: boolean
	/**
	 * Let admin-managed subscriptions use `http:`. Default `false`: the body is the document and the
	 * custom headers are where a receiver's credential goes. Code subscriptions are never held to this.
	 */
	allowHttp?: boolean
}

/** Replace the default fields, or transform them (the idiomatic Payload form). */
export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

/**
 * Override slot for a collection this plugin builds. Spread over our defaults, so any collection
 * key can be replaced; `fields` additionally accepts a function that receives our default fields
 * to compose with. Two things are not replaceable: the slug, which has its own option and is wired
 * into the delivery task and the endpoints, and the plugin's own endpoints, which `endpoints` here
 * adds to.
 */
export type CollectionOverride = { fields?: FieldsOverride } & Partial<
	Omit<CollectionConfig, 'fields' | 'slug'>
>

export type SecretEncryptionOptions = {
	/**
	 * Key ring for the stored signing secrets, passed straight through to `@10x-media/fields`.
	 * With no keys configured the encryption key derives from `PAYLOAD_SECRET`, so changing that
	 * makes every stored secret unreadable; pin the current key here first and a `PAYLOAD_SECRET`
	 * change costs one config line instead of a capture-and-restore script.
	 *
	 * This is the *encryption* key ring, unrelated to `secretRotation`, which is about the signing
	 * secret a receiver verifies with.
	 */
	keys?: KeysConfig
}

export type SecretRotationOptions = {
	/**
	 * Seconds a rotated-out secret keeps signing alongside its replacement, giving receivers time
	 * to pick up the new one. Zero retires the old secret immediately.
	 */
	graceSeconds?: number
}

export type WebhooksPluginOptions = {
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/webhooks/i18n`. Values win over
	 * the built-in locales key-by-key; locales the plugin does not ship are added
	 * whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/**
	 * Collections that emit events, keyed by slug. Typed against the host's generated
	 * `CollectionSlug`, so a typo or a global's slug is a type error rather than a source that
	 * compiles and then never emits; without generated types the key falls back to `string`.
	 */
	collections?: Partial<Record<CollectionSlug, true | CollectionWebhookConfig>>
	subscriptions?: CodeSubscription[]
	delivery?: DeliveryMode | DeliveryOptions
	subscriptionsCollection?: { slug?: string; hidden?: boolean; overrides?: CollectionOverride }
	deliveriesLog?: {
		slug?: string
		hidden?: boolean
		overrides?: CollectionOverride
		/**
		 * Days a finished delivery (`success` or `dead`) is kept. Unset, the log is never pruned.
		 * The log stores the full body of every delivery, so it grows with every write to a watched
		 * collection. Pruning runs after an event is dispatched, at most once an hour per process;
		 * `pruneDeliveries` is exported for a cron that wants it on a schedule.
		 */
		retentionDays?: number
	}
	secretEncryption?: SecretEncryptionOptions
	secretRotation?: SecretRotationOptions
	/**
	 * Who each admin-managed subscription acts as. With it set, delivery rows record their owner
	 * in `ownerId` and `ownerCollection` (two new columns on a SQL adapter), which is what a
	 * tenant-scoped `deliveriesLog.overrides.access.read` matches on.
	 */
	owner?: SubscriptionOwnership
	/**
	 * Guarantee that a subscription never receives a document its owner could not read. Checked on
	 * save (the owner must be able to read every collection the subscription's events come from)
	 * and again per document on dispatch, where the document is re-read through Payload's access
	 * control as the owner and that view, at depth 0, is what is sent. `previousData` is not sent
	 * to an owner-bound subscription. Requires `owner`, and explicit access functions for both of
	 * the plugin's collections.
	 */
	enforceOwnerAccess?: boolean
}

export type ResolvedSecretRotationOptions = {
	graceSeconds: number
}

export const resolveSecretRotationOptions = (
	rotation: WebhooksPluginOptions['secretRotation']
): ResolvedSecretRotationOptions => {
	const graceSeconds = rotation?.graceSeconds ?? DEFAULT_ROTATION_GRACE_SECONDS
	if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
		throw new Error(
			`@10x-media/webhooks: secretRotation.graceSeconds must be a non-negative number, got ${graceSeconds}.`
		)
	}
	// Rotation usually follows an exposure, so an unbounded window would keep the compromised
	// secret signing for as long as it names. Out of range fails rather than being clamped.
	if (graceSeconds > MAX_ROTATION_GRACE_SECONDS) {
		throw new Error(
			`@10x-media/webhooks: secretRotation.graceSeconds must be at most ${MAX_ROTATION_GRACE_SECONDS} (30 days), got ${graceSeconds}.`
		)
	}
	return { graceSeconds }
}

export type ResolvedDeliveryOptions = {
	mode: DeliveryMode
	timeoutMs: number
	retries: number
	queue: string
	allowedHosts?: string[]
	urlPolicy: UrlPolicy
}

export const resolveDeliveryOptions = (
	delivery: WebhooksPluginOptions['delivery']
): ResolvedDeliveryOptions => {
	const opts: DeliveryOptions =
		delivery === undefined ? {} : typeof delivery === 'string' ? { mode: delivery } : delivery
	return {
		mode: opts.mode ?? 'auto',
		timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		retries: opts.retries ?? DEFAULT_RETRIES,
		queue: opts.queue ?? DEFAULT_DELIVERY_QUEUE,
		allowedHosts: opts.allowedHosts,
		urlPolicy: {
			allowedHosts: opts.allowedHosts,
			allowHttp: opts.allowHttp ?? false,
			allowPrivateAddresses: opts.allowPrivateAddresses ?? false,
		},
	}
}
