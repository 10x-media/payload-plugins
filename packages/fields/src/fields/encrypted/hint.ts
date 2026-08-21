import type { EncryptedHintConfig } from './types'

/**
 * Ceiling on the plaintext characters a hint may expose across both ends.
 *
 * A ceiling alone is a poor safety control, because what makes a hint safe is
 * how much of the value stays hidden, not how much shows: 32 characters of a
 * 128-character token is nothing, and 32 of a 40-character one is most of it.
 * `makeHint` enforces the ratio, and this is the blunt upper bound on top of
 * it, high enough for the prefixed formats credentials actually use
 * (`sk_live_`, `whsec_`, `ghp_`, `xoxb-`), where a fixed budget would be spent
 * on a constant that identifies nothing.
 */
export const HINT_MAX_CHARS = 32
/**
 * Floor on the characters a hint must leave hidden, whatever the ratio allows.
 * Below this a short value is guessable however small a fraction is exposed.
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
 *
 * Two length guards, because a hint's safety is a property of the value it
 * slices rather than of the config that asks for the slice. The hidden
 * remainder must be at least as long as the exposed ends, so a config sized
 * for long tokens degrades to no hint on a short value instead of exposing
 * half of it; and it must clear an absolute floor, since a short value stays
 * guessable at any ratio. A config within the old 8-character ceiling can
 * never fail the ratio it did not have to satisfy before: it already had to
 * leave `HINT_MIN_HIDDEN` hidden, which was the same 8.
 */
export const makeHint = (plaintext: unknown, hint: NormalizedHint): string | null => {
	if (typeof plaintext !== 'string') {
		return null
	}
	const exposed = hint.prefix + hint.suffix
	const hidden = plaintext.length - exposed
	if (hidden < HINT_MIN_HIDDEN || hidden < exposed) {
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
 * Widest rendered hint, in characters, before the concealed run starts giving
 * up space. Sized so a hint at the full exposure cap still fits a field at a
 * third of the form width, and a table column holding one stays readable.
 */
/**
 * Renders a stored hint for display: the canonical gap becomes the `maskDots`
 * bullet run, so `sk_d····9d3f` with maskDots 8 shows as `sk_d••••••••9d3f`.
 *
 * The run is additive: the hint's ends wrap the exact bullet run a hint-less
 * concealed value shows, never fewer. One count everywhere is what makes the
 * bullets legible as "concealed" rather than as information, and it keeps the
 * count a pure presentation choice, decided by `maskDots` alone. A hint too
 * wide for its container is the container's problem, and both the input and
 * the list cell clamp with an ellipsis rather than letting the run absorb it.
 */
export const formatHint = (hint: string, dots: number): string => {
	const index = hint.indexOf(HINT_GAP)
	if (index === -1) {
		return hint
	}
	return `${hint.slice(0, index)}${'•'.repeat(Math.max(1, Math.trunc(dots)))}${hint.slice(index + HINT_GAP.length)}`
}
