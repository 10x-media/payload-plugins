import type { ResolvedOverlay } from './resolveOptions'

export type KnownEntities = {
	collectionSlugs: string[]
	globalSlugs: string[]
	/** Keys of `admin.components.views` as they stand when the plugin runs. */
	viewKeys: string[]
}

const fail = (message: string): never => {
	throw new Error(`[settings-overlay] ${message}`)
}

/**
 * Boot-time checks. Every message names the overlay and the slug, because a plugin that
 * says "invalid config" at boot is a plugin somebody has to debug by bisection.
 */
export const validateOverlays = (overlays: ResolvedOverlay[], known: KnownEntities): void => {
	const seenOverlayIds = new Set<string>()
	const ownerByCollection = new Map<string, string>()
	const ownerByGlobal = new Map<string, string>()

	for (const overlay of overlays) {
		if (!overlay.id) {
			fail('An overlay is missing an id.')
		}
		if (seenOverlayIds.has(overlay.id)) {
			fail(`Duplicate overlay id "${overlay.id}". Each overlay must have a unique id.`)
		}
		seenOverlayIds.add(overlay.id)

		const seenItemSlugs = new Set<string>()

		for (const item of overlay.items) {
			if (!item.slug) {
				fail(`Overlay "${overlay.id}" has an item with no slug.`)
			}
			if (seenItemSlugs.has(item.slug)) {
				fail(`Overlay "${overlay.id}" lists item slug "${item.slug}" twice.`)
			}
			seenItemSlugs.add(item.slug)

			switch (item.type) {
				case 'collection': {
					if (!known.collectionSlugs.includes(item.slug)) {
						fail(`Overlay "${overlay.id}" lists unknown collection "${item.slug}".`)
					}
					const owner = ownerByCollection.get(item.slug)
					if (owner) {
						fail(
							`Collection "${item.slug}" is listed in overlays "${owner}" and "${overlay.id}"; an entity can live in one overlay only.`
						)
					}
					ownerByCollection.set(item.slug, overlay.id)
					break
				}
				case 'component': {
					if (!item.component) {
						fail(`Component "${item.slug}" in overlay "${overlay.id}" has no component.`)
					}
					break
				}
				case 'global': {
					if (!known.globalSlugs.includes(item.slug)) {
						fail(`Overlay "${overlay.id}" lists unknown global "${item.slug}".`)
					}
					const owner = ownerByGlobal.get(item.slug)
					if (owner) {
						fail(
							`Global "${item.slug}" is listed in overlays "${owner}" and "${overlay.id}"; an entity can live in one overlay only.`
						)
					}
					ownerByGlobal.set(item.slug, overlay.id)
					break
				}
				case 'link': {
					if (!item.href?.startsWith('/')) {
						fail(
							`Link "${item.slug}" in overlay "${overlay.id}" needs an href relative to the admin route.`
						)
					}
					break
				}
				case 'view': {
					if (!item.viewKey) {
						fail(`View "${item.slug}" in overlay "${overlay.id}" has no viewKey.`)
					}
					if (!known.viewKeys.includes(item.viewKey)) {
						fail(
							`View "${item.slug}" in overlay "${overlay.id}" points at "${item.viewKey}", which is not registered in admin.components.views. Plugins that register views must run before settingsOverlay.`
						)
					}
					break
				}
			}
		}
	}
}
