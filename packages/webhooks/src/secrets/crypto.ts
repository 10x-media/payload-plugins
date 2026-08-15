import type { Payload } from 'payload'

import { CIPHER_PREFIX } from '../constants'
import { isNormalizedSecret } from './format'

/** Payload's `encrypt` emits lowercase hex: a 32-char IV followed by the ciphertext. */
const CIPHER_BODY = /^[0-9a-f]{32}[0-9a-f]+$/

/**
 * True for a value this module produced. Payload's `encrypt` uses aes-256-ctr, whose output is
 * unauthenticated and indistinguishable from arbitrary text, and whose `decrypt` returns garbage
 * rather than throwing on a wrong key. Trial decryption therefore cannot answer "is this already
 * encrypted?", so the stored value carries an explicit tag instead. That is what keeps an update
 * from encrypting an already-encrypted secret a second time.
 */
export const isEncryptedSecret = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.startsWith(CIPHER_PREFIX) &&
	CIPHER_BODY.test(value.slice(CIPHER_PREFIX.length))

/**
 * Tag and encrypt a plaintext `whsec_` secret for storage. Already-encrypted input is returned
 * unchanged so the hook is idempotent across repeated writes of the same document.
 */
export const encryptSecret = (payload: Payload, plaintext: string): string =>
	isEncryptedSecret(plaintext) ? plaintext : `${CIPHER_PREFIX}${payload.encrypt(plaintext)}`

/**
 * Recover the plaintext secret, or null when the value cannot be trusted. aes-256-ctr has no
 * authentication tag, so a wrong key (typically a rotated `PAYLOAD_SECRET`) yields plausible
 * bytes rather than an error. Requiring the result to be a well-formed `whsec_` secret is the
 * integrity check the cipher does not provide: it turns a silent wrong-key decrypt into a
 * refusal to sign rather than deliveries signed with a garbage key.
 */
export const decryptSecret = (payload: Payload, stored: string): string | null => {
	if (!isEncryptedSecret(stored)) {
		return isNormalizedSecret(stored) ? stored : null
	}
	try {
		const plaintext = payload.decrypt(stored.slice(CIPHER_PREFIX.length))
		return isNormalizedSecret(plaintext) ? plaintext : null
	} catch {
		return null
	}
}
