import { evaluateCondition } from '../conditions/evaluate'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry, type FieldTypeRegistry } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import { defaultValidationRules } from '../validation/builtin'
import { buildRuleRegistry, type ValidationRuleRegistry } from '../validation/registry'
import type { AnyValidationRuleDefinition } from '../validation/types'

/** Build the field-type registry from the bundled defaults plus any consumer-supplied extra definitions. */
export const buildFieldTypeRegistry = (extra: AnyFormFieldDefinition[] = []): FieldTypeRegistry =>
	buildRegistry([...defaultFieldDefinitions, ...extra])

/** Build the validation-rule registry from the bundled defaults plus consumer extras. */
export const buildValidationRuleRegistry = (
	extra: AnyValidationRuleDefinition[] = []
): ValidationRuleRegistry => buildRuleRegistry([...defaultValidationRules, ...extra])

/** The subset of fields currently visible, evaluating each field's `visibleWhen` against the answers. */
export const visibleFields = (
	fields: FormFieldInstance[],
	values: Record<string, unknown>
): FormFieldInstance[] => fields.filter((field) => evaluateCondition(field.visibleWhen, values))
