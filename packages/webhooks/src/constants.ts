export const DEFAULT_SUBSCRIPTIONS_SLUG = 'webhook-subscriptions'
export const DEFAULT_DELIVERIES_SLUG = 'webhook-deliveries'
export const ADMIN_GROUP = 'Webhooks'
export const WEBHOOK_DELIVER_TASK = 'webhooksDeliver'
export const DEFAULT_DELIVERY_QUEUE = 'default'
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_RETRIES = 4

/** Placeholder returned for the signing secret on every read after its single create reveal. */
export const SECRET_MASK = '__redacted__'

/**
 * Standard Webhooks secret prefix. Stripped before the remainder is base64-decoded into the
 * HMAC key, matching the reference verifier (`standardwebhooks`), which does the same.
 */
export const SECRET_PREFIX = 'whsec_'

/** Signature scheme tag in the `webhook-signature` header, per Standard Webhooks. */
export const SIGNATURE_VERSION = 'v1'

/** Random bytes behind a generated secret, base64-encoded after the `whsec_` prefix. */
export const SECRET_BYTES = 32

/**
 * Floor for the decoded key material of a customer-supplied secret. Base64 will happily decode
 * a two-character string, so a length that low has to be rejected outright rather than silently
 * signing with a guessable key.
 */
export const MIN_SECRET_BYTES = 16

/**
 * `req.context` flags that opt a subscription read into seeing the raw signing secret.
 * The field `afterRead` mask runs even under `overrideAccess`, so internal signing reads
 * must set `revealSecretForSigning` to recover the raw value; `revealSecretOnce` is set by
 * the create `beforeChange` so the create response shows the secret exactly once.
 */
export const SECRET_REVEAL_CONTEXT = {
	forSigning: 'webhooksRevealSecretForSigning',
	once: 'webhooksRevealSecretOnce',
} as const
export const RESERVED_SLUGS = [
	'payload-jobs',
	'payload-locks',
	'payload-preferences',
	'payload-migrations',
] as const
