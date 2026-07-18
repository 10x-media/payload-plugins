import type { PayloadRequest } from 'payload'

/**
 * Payload runs field `beforeChange` hooks BEFORE `validate`, so by the time
 * validate runs the value is already sealed. The seal hook stashes the pre-seal
 * plaintext on `req.context` keyed by field path; the composed validate reads it
 * back and validates the PLAINTEXT inside Payload's native validate pass. That
 * pass honors `skipValidation` (drafts/autosave) and aggregates field errors
 * with the right path and `req.t`, none of which a throw from the hook can do.
 *
 * Kept free of node:crypto: this runs on the validate path, not just the server
 * seal path.
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

/** Path segments to a stable string key; the hook and validate both key by path. */
export const stashKey = (path: readonly (number | string)[] | undefined): string =>
	(path ?? []).join('.')

export const stashPlaintext = (req: PayloadRequest, key: string, plaintext: unknown): void => {
	stashOf(req)[key] = plaintext
}

/** A passthrough write (sealed/null/undefined) has no plaintext to validate. */
export const clearPlaintext = (req: PayloadRequest, key: string): void => {
	const context = req.context as Record<string, unknown> | undefined
	const stash = context?.[STASH_KEY] as Stash | undefined
	if (stash) {
		delete stash[key]
	}
}

export const takePlaintext = (
	req: PayloadRequest,
	key: string
): { found: boolean; plaintext: unknown } => {
	const context = req.context as Record<string, unknown> | undefined
	const stash = context?.[STASH_KEY] as Stash | undefined
	if (stash && Object.hasOwn(stash, key)) {
		const plaintext = stash[key]
		delete stash[key]
		return { found: true, plaintext }
	}
	return { found: false, plaintext: undefined }
}
