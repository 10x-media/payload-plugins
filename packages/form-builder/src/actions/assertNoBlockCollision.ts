import type { Config } from 'payload'
import type { ActionRegistry } from './registry'

/**
 * Fail fast at boot when a registered action type collides with a host block slug. Payload resolves
 * blocks globally by slug, so a shared slug makes a saved action document read back with the content
 * block's fields merged in, silently polluting the stored shape and admin tabs. Rather than let that
 * happen quietly, throw a clear error naming the collision so the author renames one side. Action block
 * slugs stay the raw type (renaming them would break every already-stored action), so this detection is
 * the non-breaking guard.
 */
export const assertNoActionBlockCollision = (config: Config, registry: ActionRegistry): void => {
	const hostSlugs = new Set<string>()
	for (const block of Array.isArray(config.blocks) ? config.blocks : []) {
		if (block && typeof block === 'object' && typeof block.slug === 'string') {
			hostSlugs.add(block.slug)
		}
	}
	for (const type of registry.keys()) {
		if (hostSlugs.has(type)) {
			throw new Error(
				`@10x-media/form-builder: action type "${type}" collides with an existing Payload block slug "${type}". Rename the action type or the block.`
			)
		}
	}
}
