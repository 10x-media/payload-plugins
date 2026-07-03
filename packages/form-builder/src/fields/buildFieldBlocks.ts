import type { Block, Field } from 'payload'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { buildConsentSourceConfig } from '../consent/buildConsentSourceConfig'
import type { ConsentSourceRegistry } from '../consent/registry'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import { buildRuleBlocks } from '../validation/buildRuleBlocks'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { FieldTypeRegistry } from './registry'
import { sharedFieldConfig } from './sharedConfig'

/** One add-field block per registered type: shared config, the type's own config, then its validations. */
export const buildFieldBlocks = (
	registry: FieldTypeRegistry,
	ruleRegistry: ValidationRuleRegistry,
	consentRegistry?: ConsentSourceRegistry
): Block[] => {
	const conditionTypes = buildConditionTypeMap(registry)
	const blocks: Block[] = []
	for (const definition of registry.values()) {
		let typeConfig: Field[] = definition.config ?? []

		// Inject dynamic source select + conditional sourceConfig group for the consent field.
		// consent.ts intentionally omits source/sourceConfig; the live registry drives the
		// select options and per-source field visibility (admin.condition).
		if (definition.type === 'consent' && consentRegistry) {
			// statement is first; optional is last; source/sourceConfig go in between.
			const statement = typeConfig.find((f) => (f as { name?: string }).name === 'statement')
			const optional = typeConfig.find((f) => (f as { name?: string }).name === 'optional')
			typeConfig = [
				...(statement ? [statement] : []),
				...buildConsentSourceConfig(consentRegistry),
				...(optional ? [optional] : []),
			]
		}

		blocks.push({
			slug: definition.type,
			labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
			fields: [
				...sharedFieldConfig(conditionTypes),
				...typeConfig,
				{
					name: 'validations',
					type: 'blocks',
					label: labelFor(keys.validationsLabel),
					blocks: buildRuleBlocks(ruleRegistry, definition.type),
				},
			],
		})
	}
	return blocks
}
