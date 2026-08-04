import type { IconLayer, IconLayerContext, IconManifest } from '../../../types'

type Entry = { at: number; manifest: Promise<IconManifest> }

const cache = new Map<string, Entry>()

/**
 * Distinct per adapter, because two adapters may legitimately use the same layer id, and
 * per the layer's own scope. Slug and id are identical across tenants by construction, so
 * a layer whose listing varies by request must widen the key or it would serve one
 * tenant's manifest to another.
 */
const keyFor = (slug: string, layer: IconLayer, ctx: IconLayerContext): string =>
	`${slug}::${layer.id}::${layer.cacheKey?.(ctx) ?? ''}`

const isFresh = (entry: Entry, layer: IconLayer): boolean => {
	const policy = layer.cache ?? 'forever'
	if (policy === 'forever') return true
	return Date.now() - entry.at < policy.ttl
}

/**
 * A layer's manifest listing, cached to its declared policy. `'forever'` is the default
 * and reproduces how a static build artifact has always been cached; a `ttl` suits a
 * layer whose contents change at runtime.
 *
 * Only the drawer *listing* comes from here. Validation goes through `resolveMeta`, which
 * is deliberately never cached, so an icon added at runtime is valid immediately even
 * while this listing is still stale.
 */
export const loadLayerManifest = (
	slug: string,
	layer: IconLayer,
	ctx: IconLayerContext
): Promise<IconManifest> => {
	const key = keyFor(slug, layer, ctx)
	const existing = cache.get(key)
	if (existing && isFresh(existing, layer)) return existing.manifest
	const manifest = layer.loadManifest(ctx)
	cache.set(key, { at: Date.now(), manifest })
	// A rejected load must not poison the entry for the process lifetime; evict so the
	// next call retries. Same contract the adapter-level manifest cache already keeps.
	void manifest.catch(() => {
		if (cache.get(key)?.manifest === manifest) cache.delete(key)
	})
	return manifest
}

/** Drops cached listings. Without a slug it clears everything, which is what tests want. */
export const invalidateLayerManifests = (slug?: string): void => {
	if (slug === undefined) {
		cache.clear()
		return
	}
	for (const key of cache.keys()) {
		if (key.startsWith(`${slug}::`)) cache.delete(key)
	}
}
