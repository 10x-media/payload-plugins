import type { Block } from 'payload'
import { labelFor } from '../translations/server'
import type { FieldTypeRegistry } from './registry'
import { sharedFieldConfig } from './sharedConfig'

/** One add-field block per registered type: shared config first, then the type's own `config`. */
export const buildFieldBlocks = (registry: FieldTypeRegistry): Block[] => {
	const blocks: Block[] = []
	for (const definition of registry.values()) {
		blocks.push({
			slug: definition.type,
			labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
			fields: [...sharedFieldConfig(), ...(definition.config ?? [])],
		})
	}
	return blocks
}
