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
	const collectionHiding = new Map<string, { hide: boolean; overlayId: string }>()
	const globalHiding = new Map<string, { hide: boolean; overlayId: string }>()

	/**
	 * An entity may appear in several overlays: the rail, the URL and the render cache are all
	 * keyed by overlay, so two panels can show the same collection without interfering.
	 *
	 * What cannot differ is `hideEntities`, because hiding is a property of the entity rather
	 * than of the panel. Two overlays asking for opposite things is a contradiction with no
	 * defensible resolution, so it is refused rather than silently decided.
	 */
	const checkHiding = (args: {
		hide: boolean
		kind: 'Collection' | 'Global'
		overlayId: string
		seen: Map<string, { hide: boolean; overlayId: string }>
		slug: string
	}): void => {
		const { hide, kind, overlayId, seen, slug } = args
		const previous = seen.get(slug)
		if (previous && previous.hide !== hide) {
			const [hidden, shown] = previous.hide
				? [previous.overlayId, overlayId]
				: [overlayId, previous.overlayId]
			fail(
				`${kind} "${slug}" is listed in overlays "${previous.overlayId}" and "${overlayId}" with different hideEntities values. "${hidden}" hides it from the nav and its own route, "${shown}" leaves it there, and an entity can only be one or the other. Set the same value on both.`
			)
		}
		seen.set(slug, { hide, overlayId })
	}

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
					checkHiding({
						hide: overlay.hideEntities,
						kind: 'Collection',
						overlayId: overlay.id,
						seen: collectionHiding,
						slug: item.slug,
					})
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
					checkHiding({
						hide: overlay.hideEntities,
						kind: 'Global',
						overlayId: overlay.id,
						seen: globalHiding,
						slug: item.slug,
					})
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
