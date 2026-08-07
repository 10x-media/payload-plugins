import type { CollectionConfig, Config, CustomComponent, GlobalConfig } from 'payload'

import { collectionTargetKey, globalTargetKey } from '../shared/targetKeys'
import type { ResolvedWikiOptions } from './resolveOptions'

const TRIGGER_COMPONENT = '@10x-media/admin-wiki/client#WikiSurfaceTrigger'

const trigger = (targetKey: string, variant: 'button' | 'menuItem'): CustomComponent => ({
	clientProps: { targetKey, variant },
	path: TRIGGER_COMPONENT,
})

type CollectionComponents = NonNullable<NonNullable<CollectionConfig['admin']>['components']>

const applyToCollection = (collection: CollectionConfig, resolved: ResolvedWikiOptions): void => {
	const targetKey = collectionTargetKey(collection.slug)
	collection.admin ??= {}
	collection.admin.components ??= {}
	const components = collection.admin.components as CollectionComponents
	switch (resolved.triggers.list) {
		case 'actions': {
			components.views ??= {}
			components.views.list ??= {}
			components.views.list.actions = [
				...(components.views.list.actions ?? []),
				trigger(targetKey, 'button'),
			]
			break
		}
		case 'beforeListTable':
			components.beforeListTable = [
				...(components.beforeListTable ?? []),
				trigger(targetKey, 'button'),
			]
			break
		case 'menu':
			components.listMenuItems = [
				...(components.listMenuItems ?? []),
				trigger(targetKey, 'menuItem'),
			]
			break
		default:
			break
	}
	switch (resolved.triggers.edit) {
		case 'beforeDocumentControls': {
			components.edit ??= {}
			components.edit.beforeDocumentControls = [
				...(components.edit.beforeDocumentControls ?? []),
				trigger(targetKey, 'button'),
			]
			break
		}
		case 'menu': {
			components.edit ??= {}
			components.edit.editMenuItems = [
				...(components.edit.editMenuItems ?? []),
				trigger(targetKey, 'menuItem'),
			]
			break
		}
		default:
			break
	}
}

const applyToGlobal = (global: GlobalConfig, resolved: ResolvedWikiOptions): void => {
	if (resolved.triggers.global !== 'beforeDocumentControls') {
		return
	}
	const targetKey = globalTargetKey(global.slug)
	global.admin ??= {}
	global.admin.components ??= {}
	const components = global.admin.components as {
		elements?: { beforeDocumentControls?: CustomComponent[] }
	}
	components.elements ??= {}
	components.elements.beforeDocumentControls = [
		...(components.elements.beforeDocumentControls ?? []),
		trigger(targetKey, 'button'),
	]
}

/**
 * Inject the guide trigger into every collection and global (except the
 * wiki's own collections) at the slots chosen by `options.triggers`.
 * Globals only offer `beforeDocumentControls`; Payload has no `editMenuItems`
 * slot for them.
 */
export const registerTriggers = (config: Config, resolved: ResolvedWikiOptions): void => {
	const wikiSlugs = [resolved.slugs.pages, resolved.slugs.media]
	for (const collection of config.collections ?? []) {
		if (wikiSlugs.includes(collection.slug)) {
			continue
		}
		applyToCollection(collection, resolved)
	}
	for (const global of config.globals ?? []) {
		applyToGlobal(global, resolved)
	}
}
