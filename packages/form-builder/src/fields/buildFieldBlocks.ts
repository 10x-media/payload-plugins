import type { Block, Field, TabsField } from 'payload'
import { buildConditionTypeMap } from '../conditions/conditionType'
import { buildConsentSourceConfig } from '../consent/buildConsentSourceConfig'
import type { ConsentSourceRegistry } from '../consent/registry'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import { buildRuleBlocks } from '../validation/buildRuleBlocks'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { FieldTypeRegistry } from './registry'
import { fieldBlockTabs } from './sharedConfig'

/** The tab whose fields hold the shared basics and type config, found by the `name` field it carries. */
const fieldTabOf = (block: Block): Field[] | undefined => {
	const tabsField = block.fields.find((f): f is TabsField => f.type === 'tabs')
	return tabsField?.tabs.find((tab) => tab.fields.some((f) => 'name' in f && f.name === 'name'))
		?.fields
}

/** One add-field block per registered type: tabs holding shared config, type config, and validations. */
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
				fieldBlockTabs(conditionTypes, typeConfig, {
					name: 'validations',
					type: 'blocks',
					label: labelFor(keys.validationsLabel),
					blocks: buildRuleBlocks(ruleRegistry, definition.type),
				}),
			],
		})
	}

	// Second pass: inject subFields into the repeater block using all non-repeater blocks.
	// Done after the main loop so every sibling block is already built.
	// Repeater-in-repeater is not supported in v1; the repeater block is excluded from subFields.
	const repeaterBlock = blocks.find((b) => b.slug === 'repeater')
	if (repeaterBlock) {
		const subFieldsField: Field = {
			name: 'subFields',
			type: 'blocks',
			label: labelFor(keys.configSubFields),
			blocks: blocks.filter((b) => b.slug !== 'repeater'),
		}
		const fieldTabFields = fieldTabOf(repeaterBlock)
		;(fieldTabFields ?? (repeaterBlock.fields as Field[])).push(subFieldsField)
	}

	return blocks
}
