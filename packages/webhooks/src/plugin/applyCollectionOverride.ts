import type { CollectionConfig } from 'payload'

import type { CollectionOverride } from '../options'

const mergeHooks = (
	ours: CollectionConfig['hooks'],
	theirs: CollectionConfig['hooks']
): CollectionConfig['hooks'] => {
	if (!theirs) {
		return ours
	}
	const merged: Record<string, unknown[]> = { ...((ours ?? {}) as Record<string, unknown[]>) }
	for (const [key, hooks] of Object.entries(theirs)) {
		if (Array.isArray(hooks)) {
			merged[key] = [...(merged[key] ?? []), ...hooks]
		}
	}
	return merged as CollectionConfig['hooks']
}

/**
 * Consumer override applied as the outermost layer over a collection this plugin builds:
 * top-level keys spread over ours, admin/access merge key-by-key, consumer hooks append after
 * plugin hooks, and `fields` composes through the default-fields function. The slug is locked,
 * because the plugin has already wired it into the delivery task, the endpoints, and the
 * subscriptions lookup.
 */
export const applyCollectionOverride = (
	collection: CollectionConfig,
	override: CollectionOverride | undefined
): CollectionConfig => {
	if (!override) {
		return collection
	}
	const { access, admin, fields, hooks, labels, ...rest } = override
	return {
		...collection,
		...rest,
		access: { ...collection.access, ...(access ?? {}) },
		admin: { ...collection.admin, ...(admin ?? {}) },
		fields: fields ? fields({ defaultFields: collection.fields }) : collection.fields,
		hooks: mergeHooks(collection.hooks, hooks),
		labels: labels ?? collection.labels,
		slug: collection.slug,
	} as CollectionConfig
}
