import type { KeysConfig } from '@10x-media/fields/encrypted'
import type { CollectionConfig, Field, PayloadRequest } from 'payload'

import {
	DEFAULT_DELIVERY_QUEUE,
	DEFAULT_RETRIES,
	DEFAULT_ROTATION_GRACE_SECONDS,
	DEFAULT_TIMEOUT_MS,
	MAX_ROTATION_GRACE_SECONDS,
} from './constants'
import type { TranslationsOption } from './translations'

export type WebhookOperation = 'create' | 'update' | 'delete'

export type CollectionWebhookConfig = {
	operations?: WebhookOperation[]
	includePreviousData?: boolean
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
}

/** Replace the default fields, or transform them (the idiomatic Payload form). */
export type FieldsOverride = (args: { defaultFields: Field[] }) => Field[]

/**
 * Override slot for a collection this plugin builds. Spread over our defaults, so any collection
 * key can be replaced; `fields` additionally accepts a function that receives our default fields
 * to compose with. The slug is not overridable here: it has its own option, and the plugin wires
 * it into the delivery task and the endpoints before the override runs.
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
	collections?: Record<string, true | CollectionWebhookConfig>
	subscriptions?: CodeSubscription[]
	delivery?: DeliveryMode | DeliveryOptions
	subscriptionsCollection?: { slug?: string; hidden?: boolean; overrides?: CollectionOverride }
	deliveriesLog?: { slug?: string; hidden?: boolean; overrides?: CollectionOverride }
	secretEncryption?: SecretEncryptionOptions
	secretRotation?: SecretRotationOptions
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
	}
}
