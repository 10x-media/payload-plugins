import type { PayloadRequest, StaticLabel } from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import type { ColorPreset, ColorSchemeValue } from '../../types'
import { memoForRequest } from '../../utils/memoForRequest'
import type { ColorPresetsSource } from './options'

export type NormalizedColorPreset = {
	key: string
	label?: StaticLabel
	value: string | ColorSchemeValue
}

/**
 * One value rule for every layer: a scheme value with one member present is
 * that color in both schemes; with neither it is not a preset. Filling rather
 * than dropping keeps a mid-authored palette row pickable, and matches what a
 * plain string preset already resolves to under `resolve: 'schemes'`.
 */
const normalizeValue = (value: unknown): null | string | ColorSchemeValue => {
	if (typeof value === 'string') return value === '' ? null : value
	if (typeof value !== 'object' || value === null) return null
	const { dark, light } = value as Partial<ColorSchemeValue>
	const usableLight = typeof light === 'string' && light !== '' ? light : null
	const usableDark = typeof dark === 'string' && dark !== '' ? dark : null
	if (!usableLight && !usableDark) return null
	return {
		dark: usableDark ?? (usableLight as string),
		light: usableLight ?? (usableDark as string),
	}
}

/** String presets use the CSS value as both key and value; linked mode should prefer object presets. */
export const normalizePresets = (presets: ColorPreset[]): NormalizedColorPreset[] => {
	const normalized: NormalizedColorPreset[] = []
	for (const preset of presets) {
		if (typeof preset === 'string') {
			if (preset !== '') normalized.push({ key: preset, value: preset })
			continue
		}
		const value = normalizeValue(preset.value)
		if (value === null) continue
		normalized.push({ key: preset.key, label: preset.label, value })
	}
	return normalized
}

/**
 * Resolves a field's preset source. Falls back to the plugin registry
 * (static `presets` wins over `resolvePresets`) when the field has none.
 * Resolver calls are memoized per request via `memoKey`, so a find across
 * many docs resolves once; resolvers must therefore derive from `req`,
 * not per-doc data (documented limitation).
 */
export const resolvePresets = async (args: {
	data?: Record<string, unknown>
	memoKey: symbol
	req: PayloadRequest
	siblingData?: Record<string, unknown>
	source?: ColorPresetsSource
}): Promise<NormalizedColorPreset[]> => {
	const { data, memoKey, req, siblingData } = args
	let source = args.source
	if (!source) {
		const registry = getFieldsRegistry(req.payload.config)?.color
		source = registry?.presets ?? registry?.resolvePresets
	}
	if (!source) return []
	if (Array.isArray(source)) return normalizePresets(source)
	const resolver = source
	const resolved = await memoForRequest(req, memoKey, () => resolver({ data, req, siblingData }))
	return normalizePresets(resolved)
}
