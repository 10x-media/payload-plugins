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

/**
 * Standard Webhooks secret prefix. Stripped before the remainder is base64-decoded into the
 * HMAC key, matching the reference verifier (`standardwebhooks`), which does the same.
 */
export const SECRET_PREFIX = 'whsec_'

/** Signature scheme tag in the `webhook-signature` header, per Standard Webhooks. */
export const SIGNATURE_VERSION = 'v1'

/**
 * Prefix on the `webhook-id` header, so the value receivers dedupe on is opaque rather than the
 * delivery row's primary key. On a SQL adapter that key is a sequential integer, which would
 * publish this install's delivery volume to every receiver and make a poor dedupe key for anyone
 * consuming webhooks from more than one source.
 */
export const MESSAGE_ID_PREFIX = 'msg_'

/**
 * Pins the AAD binding of the stored secrets, which otherwise is the subscriptions collection's
 * slug. That slug is a plugin option, so a consumer renaming the collection would turn every
 * stored secret into an authentication failure nothing can recover. Never change this once
 * secrets exist: it is a re-keying event with no migration path.
 */
export const SECRET_AAD_SCOPE = '10x-webhooks:subscriptions'

/**
 * Trailing plaintext characters kept beside a stored secret so an operator can tell which key a
 * subscription holds. Every character of a signing secret is key material rather than an
 * identifier, so this is the minimum that still distinguishes two keys.
 */
export const SECRET_HINT_SUFFIX = 6

/** Random bytes behind a server-generated secret, base64-encoded after the `whsec_` prefix. */
export const SECRET_BYTES = 32

/**
 * Characters after the prefix in an admin-generated secret. The admin's Generate action samples
 * base62, which is a subset of the base64 alphabet, so a length divisible by four decodes as
 * canonical base64 (44 characters, 33 bytes) and passes the same wire-format check a supplied
 * secret does. A length that is not divisible by four would produce a value the validator
 * rejects the moment the operator tried to save it.
 */
export const GENERATED_SECRET_CHARS = 44

/**
 * Floor for the decoded key material of a customer-supplied secret. Base64 will happily decode
 * a two-character string, so a length that low has to be rejected outright rather than silently
 * signing with a guessable key.
 */
export const MIN_SECRET_BYTES = 16

/**
 * Key the create response carries the generated secret under. Write-only storage strips `secret`
 * from every read, the create response included, so the one-time reveal cannot ride on the field
 * itself and gets a name of its own.
 */
export const GENERATED_SECRET_KEY = 'generatedSecret'

/**
 * Upper bound on a rotation grace period. A window measured in years would keep an exposed secret
 * signing indefinitely, which defeats the point of rotating, so an out-of-range request is
 * rejected rather than clamped.
 */
export const MAX_ROTATION_GRACE_SECONDS = 2_592_000
export const RESERVED_SLUGS = [
	'payload-jobs',
	'payload-locks',
	'payload-preferences',
	'payload-migrations',
] as const
