import type { EncryptedHintConfig } from './types'

/** Most plaintext characters a hint may expose across both ends. */
export const HINT_MAX_CHARS = 8
/**
 * A hint is only stored when the plaintext keeps at least this many characters
 * hidden; below that, the "hint" would reconstruct most of the secret.
 */
export const HINT_MIN_HIDDEN = 8

const HINT_GAP = '····'

export interface NormalizedHint {
	prefix: number
	suffix: number
}

/** Validates and normalizes a hint config; throws with the field name on misuse. */
export const normalizeHint = (config: EncryptedHintConfig, fieldName: string): NormalizedHint => {
	const prefix = config.prefix ?? 0
	const suffix = config.suffix ?? 0
	const valid = (n: number) => Number.isInteger(n) && n >= 0
	if (!valid(prefix) || !valid(suffix) || prefix + suffix === 0) {
		throw new Error(
			`@10x-media/fields: encryptedField '${fieldName}': hint needs non-negative integer prefix/suffix with at least one character`
		)
	}
	if (prefix + suffix > HINT_MAX_CHARS) {
		throw new Error(
			`@10x-media/fields: encryptedField '${fieldName}': hint may expose at most ${HINT_MAX_CHARS} characters (got prefix ${prefix} + suffix ${suffix})`
		)
	}
	return { prefix, suffix }
}

/**
 * The stored identification hint for one plaintext, e.g. `sk_l····9d3f`, or
 * null when the value is not a string or too short to hint without giving most
 * of it away. Computed at seal time only; reads never touch the plaintext.
 */
export const makeHint = (plaintext: unknown, hint: NormalizedHint): string | null => {
	if (typeof plaintext !== 'string') {
		return null
	}
	if (plaintext.length < hint.prefix + hint.suffix + HINT_MIN_HIDDEN) {
		return null
	}
	const start = hint.prefix > 0 ? plaintext.slice(0, hint.prefix) : ''
	const end = hint.suffix > 0 ? plaintext.slice(-hint.suffix) : ''
	return `${start}${HINT_GAP}${end}`
}
