import { applyRegistryConfig, type RegistryConfig } from '../plugin/applyRegistryConfig'
import type { AnyActionDefinition } from './defineAction'

export type ActionRegistry = Map<string, AnyActionDefinition>

/** `false` removes a built-in, `true` keeps it, a definition adds or replaces one. */
export type ActionOption = boolean | AnyActionDefinition

export type ActionsConfig = RegistryConfig<AnyActionDefinition>

/**
 * Resolve the active action registry from built-in defaults and a consumer override map. `false`
 * removes a type, `true` keeps the default (no-op when none exists), a definition adds or replaces.
 * Mirrors the field-type and validation-rule registry convention.
 */
export const resolveActions = (
	defaults: Record<string, AnyActionDefinition>,
	config: ActionsConfig = {}
): ActionRegistry => applyRegistryConfig(new Map(Object.entries(defaults)), config)
