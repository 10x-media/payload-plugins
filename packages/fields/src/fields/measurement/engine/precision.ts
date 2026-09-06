import { STORAGE_FRACTION_DIGITS } from './units'

export type PrecisionMode = 'readable' | 'exact'

/**
 * A precision layer as authored by a plugin or a field: every knob optional, so
 * `resolvePrecision` can tell "not set" apart from an explicit choice while merging
 * layers. `display` is unit-id keyed; a narrower per-dimension key union comes from
 * the factory's option type, not from this engine-level shape.
 */
export type MeasurementPrecision = {
	mode?: PrecisionMode
	/** Fraction digits kept in the storage unit, applied to every write. */
	storage?: number
	/** Entry-unit typing behavior: 'quantize' rounds as you type, 'free' keeps exact input. */
	entry?: 'quantize' | 'free'
	/** Draft-repaint policy after a save/refresh. */
	draft?: 'display' | 'faithful'
	display?: Partial<Record<string, number>>
}

/** A `MeasurementPrecision` with every knob but `display` filled in. */
export type ResolvedPrecision = {
	mode: PrecisionMode
	storage: number
	entry: 'quantize' | 'free'
	draft: 'display' | 'faithful'
	display?: Partial<Record<string, number>>
}

const MODE_PRESETS: Record<PrecisionMode, Pick<ResolvedPrecision, 'draft' | 'entry'>> = {
	readable: { entry: 'quantize', draft: 'display' },
	exact: { entry: 'free', draft: 'faithful' },
}

const DEFAULT_MODE: PrecisionMode = 'readable'

/**
 * Merges precision layers low-to-high priority: pass `[pluginDefault, fieldOption]`
 * so a field's own choice always wins. A bare mode string expands to its preset
 * (readable = quantize entry + display drafts, exact = free entry + faithful
 * drafts); an explicit entry/draft/storage/display knob on any layer overrides
 * whatever the final mode's preset would otherwise imply for that knob.
 */
export const resolvePrecision = (
	layers: Array<MeasurementPrecision | PrecisionMode | undefined>
): ResolvedPrecision => {
	let mode: PrecisionMode = DEFAULT_MODE
	let storage: number = STORAGE_FRACTION_DIGITS
	let entry: ResolvedPrecision['entry'] | undefined
	let draft: ResolvedPrecision['draft'] | undefined
	let display: Partial<Record<string, number>> | undefined

	for (const raw of layers) {
		if (raw === undefined) continue
		const layer = typeof raw === 'string' ? { mode: raw } : raw
		if (layer.mode !== undefined) mode = layer.mode
		if (layer.storage !== undefined) storage = layer.storage
		if (layer.entry !== undefined) entry = layer.entry
		if (layer.draft !== undefined) draft = layer.draft
		if (layer.display !== undefined) display = { ...display, ...layer.display }
	}

	if (!Object.hasOwn(MODE_PRESETS, mode)) {
		throw new Error(`resolvePrecision: mode "${mode}" must be "readable" or "exact"`)
	}
	if (!Number.isInteger(storage) || storage < 0 || storage > 12) {
		throw new Error(`resolvePrecision: storage must be an integer between 0 and 12, got ${storage}`)
	}

	const preset = MODE_PRESETS[mode]
	return {
		mode,
		storage,
		entry: entry ?? preset.entry,
		draft: draft ?? preset.draft,
		...(display !== undefined ? { display } : {}),
	}
}
