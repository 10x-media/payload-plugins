import type { ColorSchemeValue } from '../../types'
import { PRESET_PREFIX, type ResolvedColorPreset } from './options'

export type PresetChip = {
	key: string
	label: string
	missing: boolean
	value: null | string | ColorSchemeValue
}

/**
 * Derives the chip shown in place of a raw `preset:<key>` ref in the color
 * input. Returns null outside chip mode: non-linked fields, active text
 * editing, non-ref values, or an empty key (which validate rejects anyway).
 * A ref whose key no longer resolves still chips (missing: true, label falls
 * back to the key) so the stored ref stays visible without leaking raw text.
 */
export const derivePresetChip = (args: {
	editing: boolean
	linked: boolean
	presets: ResolvedColorPreset[]
	value: unknown
}): null | PresetChip => {
	const { editing, linked, presets, value } = args
	if (!linked || editing) return null
	if (typeof value !== 'string' || !value.startsWith(PRESET_PREFIX)) return null
	const key = value.slice(PRESET_PREFIX.length)
	if (key === '') return null
	const preset = presets.find((entry) => entry.key === key)
	return {
		key,
		label: preset?.label ?? key,
		missing: !preset,
		value: preset?.value ?? null,
	}
}
