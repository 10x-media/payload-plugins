import type { ColorFormat, ColorSchemeValue } from '../../types'
import { formatColor, isColorSchemeValue, parseColor } from './engine'
import { PRESET_PREFIX } from './options'

export type PresetReference = { alpha: number; key: string }

export type PresetReferenceParts = PresetReference & { explicit: boolean }

export type PresetReferenceIssue = 'invalidAlpha' | 'missingKey' | 'unknownKey'

const ALPHA_SUFFIX = /^(100|[1-9]?[0-9])$/
const ALPHA_LIKE = /^[0-9.]+$/

/**
 * Splits a `preset:<key>[/<alpha>]` string into key and alpha, tracking whether
 * the alpha was written out. The suffix is read off the last slash and counts
 * as alpha only when it matches the integer grammar 0-100; anything else stays
 * part of the key, so slash-containing keys keep working.
 */
export const presetReferenceParts = (value: string): null | PresetReferenceParts => {
	if (!value.startsWith(PRESET_PREFIX)) return null
	const remainder = value.slice(PRESET_PREFIX.length)
	if (remainder === '') return null
	const slash = remainder.lastIndexOf('/')
	if (slash !== -1 && ALPHA_SUFFIX.test(remainder.slice(slash + 1))) {
		const key = remainder.slice(0, slash)
		if (key === '') return null
		return { alpha: Number(remainder.slice(slash + 1)), explicit: true, key }
	}
	return { alpha: 100, explicit: false, key: remainder }
}

/**
 * Client-safe parser for stored preset references. Returns null when the value
 * is not a reference; alpha defaults to 100 when no suffix is present.
 */
export const parsePresetReference = (value: string): null | PresetReference => {
	const parts = presetReferenceParts(value)
	return parts ? { alpha: parts.alpha, key: parts.key } : null
}

/** Canonical stored form: bare reference at alpha 100, `/<alpha>` suffix below. */
export const formatPresetReference = (key: string, alpha = 100): string => {
	const bounded = Math.min(100, Math.max(0, Math.round(alpha)))
	return bounded === 100 ? `${PRESET_PREFIX}${key}` : `${PRESET_PREFIX}${key}/${bounded}`
}

/**
 * Validation triage for a linked value starting with `preset:`. Bare references
 * stay lenient (a stale key degrades to the fallback at read time), but an
 * explicit alpha suffix requires the key to exist, and a numeric-looking
 * suffix outside the 0-100 grammar is rejected as an attempted alpha rather
 * than silently treated as a key. Pass `hasKey: null` to skip the existence
 * check (no presets available, or the resolver failed).
 */
export const presetReferenceIssue = (
	value: string,
	hasKey: ((key: string) => boolean) | null
): null | PresetReferenceIssue => {
	const parts = presetReferenceParts(value)
	if (!parts) return 'missingKey'
	if (!parts.explicit) {
		const slash = parts.key.lastIndexOf('/')
		const tail = slash === -1 ? '' : parts.key.slice(slash + 1)
		if (tail !== '' && ALPHA_LIKE.test(tail)) return 'invalidAlpha'
		return null
	}
	if (hasKey && !hasKey(parts.key)) return 'unknownKey'
	return null
}

const applyToCss = (css: string, alpha: number, format: ColorFormat): string => {
	const parsed = parseColor(css)
	if (!parsed) return css
	const base = Number.isFinite(parsed.alpha) ? parsed.alpha : 1
	return formatColor({ ...parsed, alpha: base * (alpha / 100) }, format)
}

/**
 * Applies a reference alpha to a resolved preset value, multiplying into any
 * alpha the color already carries (matching CSS `color-mix` toward
 * transparent). Unparseable members pass through untouched.
 */
export const applyReferenceAlpha = (
	value: string | ColorSchemeValue,
	alpha: number,
	format: ColorFormat
): string | ColorSchemeValue => {
	if (isColorSchemeValue(value)) {
		return {
			dark: applyToCss(value.dark, alpha, format),
			light: applyToCss(value.light, alpha, format),
		}
	}
	return applyToCss(value, alpha, format)
}
