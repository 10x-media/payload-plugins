import type { IconAdapter, IconMeta } from '../../../types'

const cache = new Map<string, Promise<Map<string, IconMeta>>>()

/**
 * Manifest entries keyed by name, cached per adapter slug+version for the process
 * lifetime; manifests are static build artifacts. Existence checks read `has` and
 * label lookups read `get`, because "is this name real" and "what is it called" are
 * the same question of the same manifest.
 */
export const loadManifestIndex = (adapter: IconAdapter): Promise<Map<string, IconMeta>> => {
	const key = `${adapter.slug}@${adapter.version}`
	let entry = cache.get(key)
	if (!entry) {
		entry = adapter
			.loadManifest()
			.then((manifest) => new Map(manifest.icons.map((icon) => [icon.name, icon])))
		cache.set(key, entry)
		// A rejected load must not poison the cache for the process lifetime; evict it so
		// the next call retries (a BYO adapter may load its manifest over a flaky network).
		void entry.catch(() => cache.delete(key))
	}
	return entry
}
