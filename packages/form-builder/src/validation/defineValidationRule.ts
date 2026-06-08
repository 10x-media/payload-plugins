import type { ValidationParams, ValidationRuleDefinition } from './types'

/**
 * Define a validation rule type once: its `params` become a Payload `Field[]` in the per-field
 * constraint list, its typed `validate` runs in the one engine on client and server. Built-in rules
 * use this same primitive, so custom rules are never second-class.
 */
export const defineValidationRule = <
	TParams extends ValidationParams,
	TValue = unknown,
	TData extends Record<string, unknown> = Record<string, unknown>,
>(
	rule: ValidationRuleDefinition<TParams, TValue, TData>
): ValidationRuleDefinition<TParams, TValue, TData> => rule
