import type { AnyActionDefinition } from './defineAction'

export type ActionRegistry = Map<string, AnyActionDefinition>

/** `false` removes a built-in, `true` keeps it, a definition adds or replaces one. */
export type ActionOption = boolean | AnyActionDefinition

export type ActionsConfig = Record<string, ActionOption>

/**
 * Resolve the active action registry from built-in defaults and a consumer override map. `false`
 * removes a type, `true` keeps the default (no-op when none exists), a definition adds or replaces.
 * Mirrors the field-type and validation-rule registry convention.
 */
export const resolveActions = (
	defaults: Record<string, AnyActionDefinition>,
	config: ActionsConfig = {}
): ActionRegistry => {
	const registry: ActionRegistry = new Map(Object.entries(defaults))
	for (const [type, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(type)
		} else if (option === true) {
			// keep the default; no-op when no default exists for this key
		} else {
			// Force the definition's type to the config key so the authored block slug (derived from
			// `type`) and the execution lookup (by map key) agree; otherwise the action silently never
			// runs. Mirrors the field-type, validation-rule, and poll-type registries.
			registry.set(type, { ...option, type })
		}
	}
	return registry
}
