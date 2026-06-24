import type { Block } from 'payload'
import { labelFor } from '../translations/server'
import type { ActionRegistry } from './registry'

/** One authoring block per registered action type: the action's own config fields. */
export const buildActionBlocks = (registry: ActionRegistry): Block[] => {
	const blocks: Block[] = []
	for (const definition of registry.values()) {
		blocks.push({
			slug: definition.type,
			labels: { singular: labelFor(definition.label), plural: labelFor(definition.label) },
			fields: definition.config ?? [],
		})
	}
	return blocks
}
