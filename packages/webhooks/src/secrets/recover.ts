import {
	AuthenticationFailedError,
	CorruptPlaintextError,
	decryptFieldValue,
	MalformedCiphertextError,
	UnknownKeyIdError,
} from '@10x-media/fields/encrypted'
import type { Payload } from 'payload'

import { SECRET_PREFIX } from '../constants'
import { isNormalizedSecret } from './format'

/** A stored secret recovered, or the reason it could not be, phrased as the operator's next step. */
export type RecoveredSecret = { ok: true; secret: string } | { ok: false; reason: string }

/**
 * Why one stored value could not be turned back into a signing secret.
 *
 * Each failure mode has a different fix, and collapsing them into "could not be decrypted" sends
 * an operator hunting the wrong one: a key missing from the ring is put back, a value no key
 * authenticates is a `PAYLOAD_SECRET` that changed without the old key being pinned, and a value
 * that authenticates but is not a `whsec_` secret is corrupt rather than mis-keyed.
 */
const reasonFor = (err: unknown): string => {
	if (err instanceof UnknownKeyIdError) {
		return 'it is sealed under a key id that is not in secretEncryption.keys; put that key back in the ring, or rotate the secret'
	}
	if (err instanceof AuthenticationFailedError) {
		return 'no configured key authenticates it, which is what a changed PAYLOAD_SECRET (or a dropped key) looks like; pin the previous key in secretEncryption.keys, or rotate the secret'
	}
	if (err instanceof CorruptPlaintextError) {
		return 'it authenticates but does not decode to a usable value, so the stored bytes are damaged; rotate the secret'
	}
	if (err instanceof MalformedCiphertextError) {
		return 'the stored value is not a well-formed sealed value; rotate the secret'
	}
	return err instanceof Error ? err.message : String(err)
}

/**
 * Recover the plaintext behind one stored secret field.
 *
 * A value that is not a sealed wire string comes back from `decryptFieldValue` unchanged, which
 * is what an unmigrated pre-encryption secret looks like; the `whsec_` check below is what
 * catches it, so a legacy row is refused with a message naming the adoption utility rather than
 * being signed with silently.
 *
 * The check insists the recovered value already be canonical rather than normalizing it here.
 * Every write normalizes on the way in, so a stored secret that is not canonical did not come
 * through this plugin, and quietly repairing it would sign with a key the operator never chose.
 */
export const recoverSecret = async (args: {
	payload: Payload
	subscriptionsSlug: string
	path: 'previousSecret' | 'secret'
	value: string
}): Promise<RecoveredSecret> => {
	let plaintext: unknown
	try {
		plaintext = await decryptFieldValue(args.payload, {
			collection: args.subscriptionsSlug,
			path: args.path,
			value: args.value,
		})
	} catch (err) {
		return { ok: false, reason: reasonFor(err) }
	}
	if (isNormalizedSecret(plaintext)) {
		return { ok: true, secret: plaintext }
	}
	return {
		ok: false,
		reason: `the recovered value is not a canonical '${SECRET_PREFIX}' secret, which is what a row written before encryption at rest looks like: run encryptExistingSecrets(), or rotate the secret`,
	}
}
