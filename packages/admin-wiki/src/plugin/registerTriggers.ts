import type { CollectionConfig, Config, Field, GlobalConfig } from 'payload'

import { collectionTargetKey, globalTargetKey } from '../shared/targetKeys'
import type { ResolvedWikiOptions } from './resolveOptions'

const BAND_COMPONENT = '@10x-media/admin-wiki/client#WikiListGuides'
const PANEL_COMPONENT = '@10x-media/admin-wiki/client#WikiDocumentGuides'

/**
 * Name of the injected sidebar field. Namespaced because it lands in host
 * schemas: a bare `guides` would collide with a real field sooner or later, and
 * a collection that already has this name keeps its own (see `appendPanel`).
 */
export const WIKI_GUIDES_FIELD = 'adminWikiGuides'

type CollectionComponents = NonNullable<NonNullable<CollectionConfig['admin']>['components']>

/**
 * The guides panel as a sidebar UI field.
 *
 * A UI field carries no data, is excluded from generated types, and never
 * reaches the database, so this adds a surface without touching the host's
 * schema. `disableListColumn` keeps it out of the list view's column selector,
 * where a panel of guides would be meaningless.
 */
const panelField = (targetKey: string): Field => ({
	name: WIKI_GUIDES_FIELD,
	type: 'ui',
	admin: {
		components: {
			Field: { clientProps: { targetKey }, path: PANEL_COMPONENT },
		},
		disableListColumn: true,
		position: 'sidebar',
	},
})

/**
 * Append the panel unless the entity already declares a field by that name,
 * which would make two fields share a path and is the host's field to keep.
 */
const appendPanel = (entity: CollectionConfig | GlobalConfig, targetKey: string): void => {
	const taken = entity.fields.some((field) => 'name' in field && field.name === WIKI_GUIDES_FIELD)
	if (taken) {
		return
	}
	entity.fields = [...entity.fields, panelField(targetKey)]
}

const applyToCollection = (collection: CollectionConfig, resolved: ResolvedWikiOptions): void => {
	const targetKey = collectionTargetKey(collection.slug)
	if (resolved.triggers.list !== false) {
		const { slot } = resolved.triggers.list
		collection.admin ??= {}
		collection.admin.components ??= {}
		const components = collection.admin.components as CollectionComponents
		components[slot] = [
			...(components[slot] ?? []),
			{
				clientProps: { featured: resolved.featured, slot, targetKey },
				path: BAND_COMPONENT,
			},
		]
	}
	if (resolved.triggers.edit) {
		appendPanel(collection, targetKey)
	}
}

/**
 * Give every collection and global the plugin covers its guide surface: a band
 * on collection lists, a sidebar panel on documents and globals. Excluded
 * entities are skipped, matching the walk that decided their fields carry no
 * help either.
 *
 * There is no slot to choose per surface. Each has one place the affordance
 * belongs, and the previous freedom to put a trigger in a ⋯ menu or beside Save
 * only produced placements that read as something the surface is not.
 */
export const registerTriggers = (config: Config, resolved: ResolvedWikiOptions): void => {
	const excludedCollections = new Set(resolved.exclude.collections)
	for (const collection of config.collections ?? []) {
		if (excludedCollections.has(collection.slug)) {
			continue
		}
		applyToCollection(collection, resolved)
	}
	if (!resolved.triggers.global) {
		return
	}
	const excludedGlobals = new Set(resolved.exclude.globals)
	for (const global of config.globals ?? []) {
		if (excludedGlobals.has(global.slug)) {
			continue
		}
		appendPanel(global, globalTargetKey(global.slug))
	}
}
