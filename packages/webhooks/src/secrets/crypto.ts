import type { Payload } from 'payload'

import { CIPHER_PREFIX } from '../constants'
import { isNormalizedSecret } from './format'

/**
 * True for a value this module produced. Payload's `encrypt` uses aes-256-ctr, whose output is
 * unauthenticated and indistinguishable from arbitrary text, and whose `decrypt` returns garbage
 * rather than throwing on a wrong key. Trial decryption therefore cannot answer "is this already
 * encrypted?", so the stored value carries an explicit tag instead. That is what keeps an update
 * from encrypting an already-encrypted secret a second time.
 *
 * The tag is the whole test. Validating the ciphertext body here as well would split the question
 * of what a valid ciphertext is across two places, and would answer "not encrypted" for a tagged
 * but corrupt value, which then gets encrypted a second time rather than reported as unreadable.
 * `decryptSecret` owns that judgement.
 */
export const isEncryptedSecret = (value: unknown): value is string =>
	typeof value === 'string' && value.startsWith(CIPHER_PREFIX)

/**
 * Tag and encrypt a plaintext `whsec_` secret for storage. Already-encrypted input is returned
 * unchanged so the hook is idempotent across repeated writes of the same document.
 */
export const encryptSecret = (payload: Payload, plaintext: string): string =>
	isEncryptedSecret(plaintext) ? plaintext : `${CIPHER_PREFIX}${payload.encrypt(plaintext)}`

/** Once per process: the plaintext-at-rest warning is about a stored state, not about a delivery. */
let warnedAboutPlaintext = false

/**
 * Recover the plaintext secret, or null when the value cannot be trusted. aes-256-ctr has no
 * authentication tag, so a wrong key (typically a rotated `PAYLOAD_SECRET`) yields plausible
 * bytes rather than an error. Requiring the result to be a well-formed `whsec_` secret is the
 * integrity check the cipher does not provide: it turns a silent wrong-key decrypt into a
 * refusal to sign rather than deliveries signed with a garbage key.
 */
export const decryptSecret = (payload: Payload, stored: string): string | null => {
	if (!isEncryptedSecret(stored)) {
		if (!isNormalizedSecret(stored)) {
			return null
		}
		// A well-formed but untagged secret predates encryption at rest. Signing with it keeps that
		// subscription working, but it is sitting in the database in plaintext, so say so once. The
		// value itself is never logged.
		if (!warnedAboutPlaintext) {
			warnedAboutPlaintext = true
			payload.logger.warn(
				`@10x-media/webhooks: signing with a stored secret that is not encrypted at rest. Run encryptExistingSecrets() to migrate subscriptions created before encryption was added.`
			)
		}
		return stored
	}
	try {
		const plaintext = payload.decrypt(stored.slice(CIPHER_PREFIX.length))
		return isNormalizedSecret(plaintext) ? plaintext : null
	} catch {
		return null
	}
}
