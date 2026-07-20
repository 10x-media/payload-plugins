import type { FieldTypeRegistry } from '../fields/registry'
import type { Translate } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import { runValidation } from '../validation/runValidation'

export type ValidateFieldInput = {
	field: FormFieldInstance
	value: unknown
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	answers: Record<string, unknown>
	locale: string
	t: Translate
}

export type ValidateFieldResult = { errors: string[] }

/**
 * Run client-side validation for one field, reusing the shared engine in `mode: 'client'` (server-only
 * rules are skipped, no `req`/`payload`). Every returned message is a blocking error.
 */
export const validateFieldValue = async (
	input: ValidateFieldInput
): Promise<ValidateFieldResult> => {
	const { field, value, registry, ruleRegistry, answers, locale, t } = input
	const { errors } = await runValidation({
		field,
		fieldDefinition: registry.get(field.blockType),
		value,
		fieldType: field.blockType,
		ruleRegistry,
		answers,
		locale,
		t,
		operation: 'create',
		event: 'onChange',
		mode: 'client',
	})
	return { errors }
}
