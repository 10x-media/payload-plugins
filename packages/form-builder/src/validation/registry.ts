import { applyRegistryConfig, type RegistryConfig } from '../plugin/applyRegistryConfig'
import type { AnyValidationRuleDefinition } from './types'

export type ValidationRuleRegistry = Map<string, AnyValidationRuleDefinition>

/** Per-rule opt-in: `false` removes a built-in, `true` keeps it, an object adds a new rule or replaces one. */
export type ValidationRuleOption = boolean | AnyValidationRuleDefinition

export type ValidationRulesConfig = RegistryConfig<AnyValidationRuleDefinition>

export const buildRuleRegistry = (rules: AnyValidationRuleDefinition[]): ValidationRuleRegistry => {
	const registry: ValidationRuleRegistry = new Map()
	for (const rule of rules) {
		registry.set(rule.type, rule)
	}
	return registry
}

/** Resolve the active rule registry from the built-in defaults and the plugin `rules` option. */
export const resolveValidationRules = (
	defaults: AnyValidationRuleDefinition[],
	config: ValidationRulesConfig = {}
): ValidationRuleRegistry => applyRegistryConfig(buildRuleRegistry(defaults), config)
