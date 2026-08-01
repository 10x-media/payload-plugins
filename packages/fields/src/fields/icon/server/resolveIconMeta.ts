import type { IconAdapter, IconLayerContext, IconMeta } from '../../../types'
import { loadManifestIndex } from './manifestCache'

/**
 * One icon's manifest entry, or null when the library does not have it.
 *
 * Prefers the adapter's own resolver, which a runtime-backed library uses to answer
 * from live data rather than a cached snapshot: that is what keeps validation exact
 * for a library an editor can add to. Falls back to the cached manifest index, where
 * a static library's answer is a map hit and costs nothing.
 */
export const resolveIconMeta = async (
	adapter: IconAdapter,
	name: string,
	ctx: IconLayerContext
): Promise<IconMeta | null> => {
	if (adapter.resolveMeta) return adapter.resolveMeta(name, ctx)
	return (await loadManifestIndex(adapter)).get(name) ?? null
}
