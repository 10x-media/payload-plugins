import type { Block } from 'payload'
import { resolveDefinitionLabel } from '../translations/server'
import type { ActionRegistry } from './registry'

/** One authoring block per registered action type: the action's own config fields. */
export const buildActionBlocks = (registry: ActionRegistry): Block[] => {
	const blocks: Block[] = []
	for (const definition of registry.values()) {
		const label = resolveDefinitionLabel(definition.label)
		blocks.push({
			slug: definition.type,
			labels: { singular: label, plural: label },
			fields: definition.config ?? [],
		})
	}
	return blocks
}
