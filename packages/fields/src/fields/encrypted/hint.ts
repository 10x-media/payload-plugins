import type { EncryptedHintConfig } from './types'

/** Most plaintext characters a hint may expose across both ends. */
export const HINT_MAX_CHARS = 8
/**
 * A hint is only stored when the plaintext keeps at least this many characters
 * hidden; below that, the "hint" would reconstruct most of the secret.
 */
export const HINT_MIN_HIDDEN = 8

/**
 * Canonical gap marker in the STORED hint (`sk_d····9d3f`). Storage stays
 * compact and length-neutral; display layers swap it for the field's
 * `maskDots` run via `formatHint` so the concealed span matches the masked
 * aesthetic everywhere.
 */
export const HINT_GAP = '····'

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
 * null when the value is not a string, too short to hint without giving most
 * of it away, or its exposed ends contain the gap glyph themselves (a `·` in
 * the exposed text would blur where the concealed span starts, so such values
 * store no hint; real credentials never contain U+00B7). Computed at seal
 * time only; reads never touch the plaintext.
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
	if (start.includes('·') || end.includes('·')) {
		return null
	}
	return `${start}${HINT_GAP}${end}`
}

/**
 * Renders a stored hint for display: the canonical gap becomes `dots` mask
 * bullets, so `sk_d····9d3f` with maskDots 8 shows as `sk_d••••••••9d3f`,
 * the same bullet run a hint-less concealed value shows. The dot count stays
 * cosmetic and says nothing about the hidden length.
 */
export const formatHint = (hint: string, dots: number): string => {
	const index = hint.indexOf(HINT_GAP)
	if (index === -1) {
		return hint
	}
	return `${hint.slice(0, index)}${'•'.repeat(Math.max(1, Math.trunc(dots)))}${hint.slice(index + HINT_GAP.length)}`
}
