import type { AnyValidationRuleDefinition } from './types'

export type ValidationRuleRegistry = Map<string, AnyValidationRuleDefinition>

/** Per-rule opt-in: `false` removes a built-in, `true` keeps it, an object adds a new rule or replaces one. */
export type ValidationRuleOption = boolean | AnyValidationRuleDefinition

export type ValidationRulesConfig = Record<string, ValidationRuleOption>

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
): ValidationRuleRegistry => {
	const registry = buildRuleRegistry(defaults)
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
