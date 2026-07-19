import type { StaticLabel, TextField } from 'payload'
import type { ColorFormat, ColorPreset, FieldsResolverArgs } from '../../types'

export const PRESET_PREFIX = 'preset:'

/** Key under `field.custom` carrying server-only color config (may contain functions). */
export const COLOR_CUSTOM_KEY = '@10x-media/fields'

export type ColorPresetsResolver = (args: FieldsResolverArgs) => Promise<ColorPreset[]>
export type ColorPresetsSource = ColorPreset[] | ColorPresetsResolver

export type ColorLinkedOptions = {
	/** Resolved value when a stored preset reference no longer exists. Defaults to null. */
	fallback?: null | string
}

export type ColorFieldOptions = {
	name?: string
	label?: TextField['label']
	required?: boolean
	localized?: boolean
	/** Stored format. Any parseable CSS input is normalized to this. Default 'hex'. */
	format?: ColorFormat
	/** Default true. False hides the opacity slider and strips alpha on write. */
	alpha?: boolean
	presets?: ColorPresetsSource
	presetsLabel?: StaticLabel
	linked?: boolean | ColorLinkedOptions
	/** Default true. False removes the inline clear control; required fields never render it. */
	isClearable?: boolean
	/** Default true. Chromium EyeDropper API, feature-detected at runtime. */
	enableEyedropper?: boolean
	overrides?: (args: { field: TextField }) => TextField
}

/** Serializable subset shipped to the admin client via clientProps. */
export type ColorFieldClientOptions = {
	alpha: boolean
	enableEyedropper: boolean
	format: ColorFormat
	isClearable: boolean
	linked: boolean
	linkedFallback: null | string
}

/**
 * clientProps shape the factory hands to `ColorFieldServer`. `format` stays the
 * field-level value (possibly unset) so the server can resolve the effective
 * format against the plugin registry per request before handing the client a
 * concrete `ColorFieldClientOptions`.
 */
export type ColorFieldServerOptions = Omit<ColorFieldClientOptions, 'format'> & {
	format?: ColorFormat
}

/** Preset with its label resolved to a plain string, safe for clientProps. */
export type ResolvedColorPreset = { key: string; label: string; value: string }

export type ColorFieldCustom = {
	memoKey: symbol
	presets?: ColorPresetsSource
	presetsLabel?: StaticLabel
}
