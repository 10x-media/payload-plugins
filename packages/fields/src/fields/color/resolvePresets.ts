import type { PayloadRequest, StaticLabel } from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import type { ColorPreset } from '../../types'
import { memoForRequest } from '../../utils/memoForRequest'
import type { ColorPresetsSource } from './options'

export type NormalizedColorPreset = { key: string; label?: StaticLabel; value: string }

/** String presets use the CSS value as both key and value; linked mode should prefer object presets. */
export const normalizePresets = (presets: ColorPreset[]): NormalizedColorPreset[] =>
	presets.map((preset) =>
		typeof preset === 'string'
			? { key: preset, value: preset }
			: { key: preset.key, label: preset.label, value: preset.value }
	)

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
