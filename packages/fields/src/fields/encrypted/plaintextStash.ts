import type { PayloadRequest } from 'payload'

/**
 * Payload runs field `beforeChange` hooks BEFORE `validate`, so by the time
 * validate runs the value is already sealed. The seal hook stashes the pre-seal
 * plaintext on `req.context` and the composed validate reads it back, so
 * plaintext validation runs in Payload's native validate pass. That pass honors
 * `skipValidation` (drafts/autosave) and aggregates field errors with the right
 * path and `req.t`, none of which a throw from the hook can do.
 *
 * The stash is keyed by the SEALED VALUE the hook just produced, never the field
 * path. `req.context` is shared across the documents of a bulk/concurrent write
 * (`payload.update({ where, data })` runs docs.map + Promise.all with one req),
 * so a path key ('ssn' is identical for every document) would collide: one
 * document's validate would consume another's plaintext, or none. A sealed value
 * is unique per write (fresh IV), so the key is collision-free across documents,
 * requests, and paths.
 *
 * Kept free of node:crypto: this also runs on the validate path.
 */
const STASH_KEY = '__tenxFieldsEncryptedPlaintext'

type Stash = Record<string, unknown>

const stashOf = (req: PayloadRequest): Stash => {
	const context = req.context as Record<string, unknown>
	let stash = context[STASH_KEY] as Stash | undefined
	if (!stash) {
		stash = {}
		context[STASH_KEY] = stash
	}
	return stash
}

/**
 * Stash key for a hasMany write: each sealed item is unique per IV, so their
 * join is unique per write. The separator is absent from the base64url wire
 * format, so it never merges two distinct arrays into one key.
 */
export const sealedArrayKey = (sealedItems: readonly string[]): string => sealedItems.join('\n')

export const stashPlaintext = (
	req: PayloadRequest,
	sealedKey: string,
	plaintext: unknown
): void => {
	stashOf(req)[sealedKey] = plaintext
}

export const takePlaintext = (
	req: PayloadRequest,
	sealedKey: string
): { found: boolean; plaintext: unknown } => {
	const context = req.context as Record<string, unknown> | undefined
	const stash = context?.[STASH_KEY] as Stash | undefined
	if (stash && Object.hasOwn(stash, sealedKey)) {
		const plaintext = stash[sealedKey]
		delete stash[sealedKey]
		return { found: true, plaintext }
	}
	return { found: false, plaintext: undefined }
}
