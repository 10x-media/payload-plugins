import { randomBytes } from 'node:crypto'

import { MIN_SECRET_BYTES, SECRET_BYTES, SECRET_PREFIX } from '../constants'

/**
 * Canonical base64, the only body a `whsec_` secret may carry: full four-character groups, with a
 * correctly padded final group. Accepting a ragged length instead would decode leftover bits away,
 * so a truncated paste would be taken as a valid, shorter key, and two different secret strings
 * could decode to the very same HMAC key.
 */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Raised for a malformed customer-supplied secret; callers map it to a 400 or a boot failure. */
export class InvalidSecretError extends Error {
	/** The bare explanation, without the package prefix, for callers composing their own message. */
	readonly reason: string
	constructor(reason: string, subject = 'invalid signing secret') {
		super(`@10x-media/webhooks: ${subject}: ${reason}`)
		this.name = 'InvalidSecretError'
		this.reason = reason
	}
}

/** A fresh `whsec_<base64>` secret over `SECRET_BYTES` of entropy. */
export const generateSecret = (): string =>
	`${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64')}`

/**
 * Normalize a customer-supplied secret to exactly one `whsec_` prefix and validate that the
 * remainder is base64 carrying at least `MIN_SECRET_BYTES`. Repeated prefixes are collapsed
 * rather than rejected, so pasting an already-prefixed value into a prefixing client cannot
 * persist a doubly-prefixed secret that would derive the wrong key.
 */
export const normalizeSecret = (input: string): string => {
	let body = input.trim()
	if (!body) {
		throw new InvalidSecretError('the secret is empty')
	}
	while (body.startsWith(SECRET_PREFIX)) {
		body = body.slice(SECRET_PREFIX.length)
	}
	if (!body) {
		throw new InvalidSecretError('the secret carries no key material after its prefix')
	}
	if (!BASE64.test(body)) {
		throw new InvalidSecretError(
			`the value after '${SECRET_PREFIX}' must be padded base64 with no stray characters (the Standard Webhooks verifier base64-decodes it into the HMAC key, and a ragged length would silently decode to a shorter one)`
		)
	}
	const bytes = Buffer.from(body, 'base64')
	if (bytes.length < MIN_SECRET_BYTES) {
		throw new InvalidSecretError(
			`the secret decodes to ${bytes.length} bytes; provide at least ${MIN_SECRET_BYTES} (recommend ${SECRET_BYTES})`
		)
	}
	return `${SECRET_PREFIX}${body}`
}

/** True for a value already in normalized `whsec_<base64>` form. */
export const isNormalizedSecret = (value: unknown): value is string => {
	if (typeof value !== 'string') {
		return false
	}
	try {
		return normalizeSecret(value) === value
	} catch {
		return false
	}
}

/**
 * The HMAC key behind a secret: the prefix is stripped and the remainder base64-decoded, which
 * is what `standardwebhooks` and every other Standard Webhooks library does. Signing with the
 * undecoded ASCII would produce signatures no off-the-shelf verifier accepts.
 */
export const secretKey = (secret: string): Buffer =>
	Buffer.from(normalizeSecret(secret).slice(SECRET_PREFIX.length), 'base64')
