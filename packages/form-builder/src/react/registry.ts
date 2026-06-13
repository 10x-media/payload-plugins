import type { FieldRenderer } from './contract'

export type RendererRegistry = Map<string, FieldRenderer>

/** Per-type renderer override: `false` removes, `true` keeps the default, a renderer adds or replaces one. */
export type RendererOption = boolean | FieldRenderer

export type RenderersConfig = Record<string, RendererOption>

/**
 * Resolve the active renderer registry from the defaults and a consumer override map. `false` removes a
 * type, `true` keeps the default (no-op when none exists), a renderer adds a new type or replaces one.
 * Mirrors the field-type and validation-rule registry convention.
 */
export const resolveRenderers = (
	defaults: Record<string, FieldRenderer>,
	config: RenderersConfig = {}
): RendererRegistry => {
	const registry: RendererRegistry = new Map(Object.entries(defaults))
	for (const [type, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(type)
		} else if (option === true) {
			// keep the default; no-op when no default exists for this key
		} else {
			registry.set(type, option)
		}
	}
	return registry
}
