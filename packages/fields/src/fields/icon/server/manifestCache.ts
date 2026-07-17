import type { IconAdapter } from '../../../types'

const cache = new Map<string, Promise<Set<string>>>()

/** Name sets cached per adapter slug+version for the process lifetime; manifests are static build artifacts. */
export const loadManifestNames = (adapter: IconAdapter): Promise<Set<string>> => {
	const key = `${adapter.slug}@${adapter.version}`
	let entry = cache.get(key)
	if (!entry) {
		entry = adapter
			.loadManifest()
			.then((manifest) => new Set(manifest.icons.map((icon) => icon.name)))
		cache.set(key, entry)
	}
	return entry
}
