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
 * A bare definition without `value: 'none'` would no-op silently: its instances are nameless,
 * so `validate`/`schema` never run and no value is ever stored. Failing the boot makes the
 * misconfiguration impossible to ship.
 */
const assertBareContract = (definition: AnyFormFieldDefinition): void => {
	if (definition.bare === true && definition.value !== 'none') {
		throw new Error(
			`form-builder: bare field types must be display-only (value: 'none'); '${definition.type}' declares value '${definition.value}'`
		)
	}
}

/**
 * Resolve the active field-type registry from the built-in defaults and the plugin `fields` option.
 * `false` removes a type, `true` keeps the default, an object adds a new type or replaces an existing
 * one (its `type` is forced to the config key so an override cannot rename the slot). Every resolved
 * definition must honor the bare contract; a violation throws at plugin boot.
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
	for (const definition of registry.values()) {
		assertBareContract(definition)
	}
	return registry
}
