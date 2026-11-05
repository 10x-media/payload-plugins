import type { CollectionConfig, Config } from 'payload'

import { buildCollections } from '../collections/build'
import { PAIRS_SLUG } from '../collections/slugs'
import type { CollectionOverride, ResolvedOptions } from '../options'

const hasHooks = (collection: CollectionConfig): boolean =>
	Object.values(collection.hooks ?? {}).some((hooks) => Array.isArray(hooks) && hooks.length > 0)

/**
 * Adds one of the plugin's collections, through the host's override when it gave one. The
 * slug is forced back: hooks, endpoints and the views all address the collection by name.
 */
export const addCollection = (
	config: Config,
	built: CollectionConfig,
	override: CollectionOverride | undefined
): void => {
	const collection = override ? { ...override(built), slug: built.slug } : built
	if (hasHooks(collection)) {
		throw new Error(
			`dedupe: hooks on "${built.slug}" are not supported; the plugin writes this collection through the database layer, which skips them`
		)
	}
	config.collections = [...(config.collections ?? []), collection]
}

/** The pairs. Registered even when disabled, so a later migration does not drop them. */
export const registerCollections = (config: Config, options: ResolvedOptions): void => {
	const overrideFor: Record<string, CollectionOverride | undefined> = {
		[PAIRS_SLUG]: options.overrides.pairs,
	}
	for (const built of buildCollections(options.collectionAccess.read)) {
		addCollection(config, built, overrideFor[built.slug])
	}
}
