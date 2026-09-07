import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type { HiddenPredicate, HiddenPredicates } from '../types'
import { ACTIONS_PATH, REPORTER_PATH } from './constants'
import type { ResolvedOverlay } from './resolveOptions'

type Listed = { hide: boolean }

/**
 * A listed collection carries two plugin components in `beforeDocumentControls`: the
 * form-modified reporter, and the document actions the panel needs because Payload's own menu
 * has nobody to report to. Both render nothing outside a panel.
 */
const withPanelComponents = (collection: CollectionConfig, hide: boolean): CollectionConfig => {
	const existing = collection.admin?.components?.edit?.beforeDocumentControls ?? []
	return {
		...collection,
		admin: {
			...collection.admin,
			...(hide ? { hidden: true } : {}),
			components: {
				...collection.admin?.components,
				edit: {
					...collection.admin?.components?.edit,
					beforeDocumentControls: [...existing, REPORTER_PATH, ACTIONS_PATH],
				},
			},
		},
	}
}

/** A global has no delete, duplicate or restore, so it takes the reporter alone. */
const withReporterGlobal = (global: GlobalConfig, hide: boolean): GlobalConfig => {
	const existing = global.admin?.components?.elements?.beforeDocumentControls ?? []
	return {
		...global,
		admin: {
			...global.admin,
			...(hide ? { hidden: true } : {}),
			components: {
				...global.admin?.components,
				elements: {
					...global.admin?.components?.elements,
					beforeDocumentControls: [...existing, REPORTER_PATH],
				},
			},
		},
	}
}

/**
 * Hides every listed collection and global from the nav and its own route, and appends the
 * plugin's own `beforeDocumentControls` components: the form-modified reporter everywhere, and
 * the document actions on collections.
 *
 * An entity may already gate itself with a function-valued `admin.hidden`. Overwriting that
 * with `true` would lose the rule, so the predicate is lifted out and returned for the
 * manifest to apply per reader. A literal `hidden: true` carries no rule and is simply kept.
 */
export const hideEntities = (
	config: Config,
	overlays: ResolvedOverlay[]
): {
	collections: Config['collections']
	globals: Config['globals']
	hiddenPredicates: HiddenPredicates
} => {
	// Keyed by slug, not by overlay: an entity may be listed in several, and hiding is a property
	// of the entity. Boot validation has already refused any pair that disagrees on `hideEntities`,
	// so whichever listing lands here last carries the same value as the rest.
	const listedCollections = new Map<string, Listed>()
	const listedGlobals = new Map<string, Listed>()

	for (const overlay of overlays) {
		for (const item of overlay.items) {
			if (item.type === 'collection') {
				listedCollections.set(item.slug, { hide: overlay.hideEntities })
			}
			if (item.type === 'global') {
				listedGlobals.set(item.slug, { hide: overlay.hideEntities })
			}
		}
	}

	const hiddenPredicates: HiddenPredicates = { collections: {}, globals: {} }

	const collections = (config.collections ?? []).map((collection) => {
		const listed = listedCollections.get(collection.slug)
		if (!listed) {
			return collection
		}
		if (typeof collection.admin?.hidden === 'function') {
			hiddenPredicates.collections[collection.slug] = collection.admin.hidden as HiddenPredicate
		}
		return withPanelComponents(collection, listed.hide)
	})

	const globals = (config.globals ?? []).map((global) => {
		const listed = listedGlobals.get(global.slug)
		if (!listed) {
			return global
		}
		if (typeof global.admin?.hidden === 'function') {
			hiddenPredicates.globals[global.slug] = global.admin.hidden as HiddenPredicate
		}
		return withReporterGlobal(global, listed.hide)
	})

	return { collections, globals, hiddenPredicates }
}
