import type {
	IconAdapter,
	IconLayer,
	IconLayerContext,
	IconManifest,
	IconMeta,
} from '../../../types'
import { coalesceResolveMany } from './coalesce'
import { loadLayerManifest } from './manifestCache'

/** Codepoint order, matching the codegen, so a merged category list is stable across runs. */
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The merged listing a drawer browses. Later layers win by name and may add names the
 * base does not have, so a runtime layer can both override and extend a static set.
 *
 * An adapter with no layers returns its own manifest untouched, which is every adapter
 * written before layers existed.
 */
export const loadLayeredManifest = async (
	adapter: IconAdapter,
	ctx: IconLayerContext
): Promise<IconManifest> => {
	const layers = adapter.layers
	if (!layers || layers.length === 0) return adapter.loadManifest()
	const loaded = await Promise.all(
		layers.map((layer) => loadLayerManifest(adapter.slug, layer, ctx))
	)
	const byName = new Map<string, IconMeta>()
	const categories = new Set<string>()
	for (const manifest of loaded) {
		for (const icon of manifest.icons) byName.set(icon.name, icon)
		for (const category of manifest.categories) categories.add(category)
	}
	return {
		categories: [...categories].sort(byCodepoint),
		icons: [...byName.values()],
	}
}

const resolveFromLayer = async (args: {
	ctx: IconLayerContext
	layer: IconLayer
	name: string
	slug: string
}): Promise<IconMeta | null> => {
	const { ctx, layer, name, slug } = args
	if (layer.resolveMetaMany) {
		const batch = await coalesceResolveMany({
			ctx,
			key: `${slug}::${layer.id}`,
			name,
			resolveMetaMany: layer.resolveMetaMany,
		})
		return batch.get(name) ?? null
	}
	if (layer.resolveMeta) return layer.resolveMeta(name, ctx)
	const manifest = await loadLayerManifest(slug, layer, ctx)
	return manifest.icons.find((icon) => icon.name === name) ?? null
}

/**
 * One icon's entry, resolved newest layer first so an override wins and an older layer
 * still answers for names the newer one lacks. Serves validation (non-null means the name
 * exists) and label resolution from the same lookup.
 */
export const resolveLayeredMeta = async (
	adapter: IconAdapter,
	name: string,
	ctx: IconLayerContext
): Promise<IconMeta | null> => {
	const layers = adapter.layers
	if (!layers || layers.length === 0) return null
	for (let index = layers.length - 1; index >= 0; index -= 1) {
		const layer = layers[index]
		if (!layer) continue
		const meta = await resolveFromLayer({ ctx, layer, name, slug: adapter.slug })
		if (meta) return meta
	}
	return null
}
