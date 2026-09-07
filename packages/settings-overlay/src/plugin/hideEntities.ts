import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type { HiddenPredicate, HiddenPredicates } from '../types'
import { REPORTER_PATH } from './constants'
import type { ResolvedOverlay } from './resolveOptions'

type Listed = { hide: boolean }

const withReporter = (collection: CollectionConfig, hide: boolean): CollectionConfig => {
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
					beforeDocumentControls: [...existing, REPORTER_PATH],
				},
			},
		},
	}
}

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
 * Hides every listed collection and global from the nav and its own route, and gives each a
 * form-modified reporter so the panel can confirm before discarding edits.
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
		return withReporter(collection, listed.hide)
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
