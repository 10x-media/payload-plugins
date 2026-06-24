import type { ActionRunArgs } from './defineAction'
import type { ActionRegistry } from './registry'

/** A stored action instance from the form's `actions` blocks array. */
export type ActionInstance = { blockType: string; [key: string]: unknown }

export type ActionResult = { type: string; ok: boolean; error?: string }

export type RunActionsArgs = Omit<ActionRunArgs, 'config'> & {
	actions: ActionInstance[]
	registry: ActionRegistry
}

/**
 * Run each configured action, isolating failures: a throwing action is captured as a failed result
 * and never breaks the others or the caller.
 */
export const runActions = async (args: RunActionsArgs): Promise<ActionResult[]> => {
	const { actions, registry, ...ctx } = args
	const results: ActionResult[] = []
	for (const instance of actions) {
		const definition = registry.get(instance.blockType)
		if (!definition) {
			continue
		}
		try {
			await definition.run({ ...ctx, config: instance })
			results.push({ type: instance.blockType, ok: true })
		} catch (error) {
			results.push({
				type: instance.blockType,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
	return results
}
