export const DEFAULT_SUBSCRIPTIONS_SLUG = 'webhook-subscriptions'
export const DEFAULT_DELIVERIES_SLUG = 'webhook-deliveries'
export const ADMIN_GROUP = 'Webhooks'
export const WEBHOOK_DELIVER_TASK = 'webhooksDeliver'
export const DEFAULT_DELIVERY_QUEUE = 'default'
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_RETRIES = 4

/**
 * How long a rotated-out secret keeps signing alongside its replacement. Expiry is evaluated at
 * send time from the stored timestamp, so the window survives restarts without a scheduler.
 */
export const DEFAULT_ROTATION_GRACE_SECONDS = 86_400

/** Placeholder returned for the signing secret on every read after its single create reveal. */
export const SECRET_MASK = '__redacted__'

/**
 * Standard Webhooks secret prefix. Stripped before the remainder is base64-decoded into the
 * HMAC key, matching the reference verifier (`standardwebhooks`), which does the same.
 */
export const SECRET_PREFIX = 'whsec_'

/** Signature scheme tag in the `webhook-signature` header, per Standard Webhooks. */
export const SIGNATURE_VERSION = 'v1'

/**
 * Marks a stored secret as ciphertext. Payload's `encrypt` is aes-256-ctr, so its output carries
 * no tag of its own and cannot be told apart from plaintext by trial decryption; this prefix is
 * what makes "already encrypted?" answerable and the encrypt hook idempotent.
 */
export const CIPHER_PREFIX = 'whenc1_'

/** Random bytes behind a generated secret, base64-encoded after the `whsec_` prefix. */
export const SECRET_BYTES = 32

/**
 * Floor for the decoded key material of a customer-supplied secret. Base64 will happily decode
 * a two-character string, so a length that low has to be rejected outright rather than silently
 * signing with a guessable key.
 */
export const MIN_SECRET_BYTES = 16

/**
 * `req.context` flags that opt a subscription read into seeing the plaintext signing secret.
 * The field `afterRead` mask runs even under `overrideAccess`, so internal signing reads
 * must set `forSigning` to decrypt the stored value; `once` is set by the create `beforeChange`
 * so the create response shows the secret exactly once. `plaintext` carries that create-time
 * value across the write, because the response reads back ciphertext and the mask hook has no
 * other way to recover what was just generated.
 */
export const SECRET_REVEAL_CONTEXT = {
	forSigning: 'webhooksRevealSecretForSigning',
	once: 'webhooksRevealSecretOnce',
	plaintext: 'webhooksRevealSecretPlaintext',
} as const
export const RESERVED_SLUGS = [
	'payload-jobs',
	'payload-locks',
	'payload-preferences',
	'payload-migrations',
] as const
