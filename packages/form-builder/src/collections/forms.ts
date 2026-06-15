import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { type FieldRow, normalizeFormConditions } from '../conditions/normalizeConditions'
import { buildFieldBlocks } from '../fields/buildFieldBlocks'
import type { FieldTypeRegistry } from '../fields/registry'
import { normalizeFlow } from '../flow/normalizeFlow'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'

export const FORMS_SLUG = 'forms'

export const buildFormsCollection = (
	registry: FieldTypeRegistry,
	ruleRegistry: ValidationRuleRegistry
): CollectionConfig => {
	const conditionTypes = buildConditionTypeMap(registry)

	const beforeValidate: CollectionBeforeValidateHook = ({ data }) => {
		if (data && Array.isArray(data.fields)) {
			const normalized: FieldRow[] = normalizeFormConditions(
				data.fields as FieldRow[],
				conditionTypes
			)
			data.fields = normalized
			const fieldNames = normalized
				.map((field: FieldRow) => (typeof field.name === 'string' ? field.name : undefined))
				.filter((name): name is string => name !== undefined)
			data.flow = normalizeFlow(data.flow, fieldNames)
		}
		return data
	}

	return {
		slug: FORMS_SLUG,
		labels: { singular: 'Form', plural: 'Forms' },
		admin: { group: 'Forms', useAsTitle: 'title' },
		access: { read: () => true },
		hooks: {
			beforeValidate: [beforeValidate],
		},
		fields: [
			{ name: 'title', type: 'text', required: true, label: labelForKey(keys.fieldTitle) },
			{ name: 'fields', type: 'blocks', blocks: buildFieldBlocks(registry, ruleRegistry) },
			{ name: 'flow', type: 'json' },
		],
	}
}
