import type { AnyFormFieldDefinition } from './types'

export type FieldTypeRegistry = Map<string, AnyFormFieldDefinition>

/** Per-type opt-in: `false` removes a built-in, `true` keeps it, an object adds a new type or replaces one. */
export type FieldTypeOption = boolean | AnyFormFieldDefinition

export type FieldTypesConfig = Record<string, FieldTypeOption>

export const buildRegistry = (definitions: AnyFormFieldDefinition[]): FieldTypeRegistry => {
	const registry: FieldTypeRegistry = new Map()
	for (const definition of definitions) {
		registry.set(definition.type, definition)
	}
	return registry
}

/**
 * Resolve the active field-type registry from the built-in defaults and the plugin `fields` option.
 * `false` removes a type, `true` keeps the default, an object adds a new type or replaces an existing
 * one (its `type` is forced to the config key so an override cannot rename the slot).
 */
export const resolveFieldTypes = (
	defaults: AnyFormFieldDefinition[],
	config: FieldTypesConfig = {}
): FieldTypeRegistry => {
	const registry = buildRegistry(defaults)
	for (const [type, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(type)
		} else if (option === true) {
			// keep the default; a no-op when no default exists for this key
		} else {
			registry.set(type, { ...option, type })
		}
	}
	return registry
}
