import type { PresentationDescriptor } from './types'

export type PresentationDescriptorRegistry = Map<string, PresentationDescriptor>

/** Per-name override: `false` removes, `true` keeps the default, a descriptor adds or replaces one. */
export type PresentationDescriptorOption = boolean | PresentationDescriptor

export type PresentationsDescriptorConfig = Record<string, PresentationDescriptorOption>

/**
 * Resolve the active presentation descriptors from the defaults and a consumer override map.
 * Mirrors the field-type, validation-rule, and renderer registry convention.
 */
export const resolvePresentationDescriptors = (
	defaults: Record<string, PresentationDescriptor>,
	config: PresentationsDescriptorConfig = {}
): PresentationDescriptorRegistry => {
	const registry: PresentationDescriptorRegistry = new Map(Object.entries(defaults))
	for (const [name, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(name)
		} else if (option === true) {
			// keep the default; no-op when no default exists for this name
		} else {
			registry.set(name, option)
		}
	}
	return registry
}
