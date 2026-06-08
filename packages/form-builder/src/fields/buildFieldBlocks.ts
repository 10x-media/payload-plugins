import type { Block } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'
import { buildRuleBlocks } from '../validation/buildRuleBlocks'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { FieldTypeRegistry } from './registry'
import { sharedFieldConfig } from './sharedConfig'

/** One add-field block per registered type: shared config, the type's own config, then its validations. */
export const buildFieldBlocks = (
	registry: FieldTypeRegistry,
	ruleRegistry: ValidationRuleRegistry
): Block[] => {
	const blocks: Block[] = []
	for (const definition of registry.values()) {
		blocks.push({
			slug: definition.type,
			labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
			fields: [
				...sharedFieldConfig(),
				...(definition.config ?? []),
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
