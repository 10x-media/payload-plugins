import type { IconAdapter, IconLayerContext, IconMeta } from '../../../types'
import { coalesceResolveMany } from '../layers/coalesce'
import { resolveLayeredMeta } from '../layers/resolve'
import { loadManifestIndex } from './manifestCache'

/**
 * One icon's manifest entry, or null when the library does not have it.
 *
 * Resolution order, first hit winning: the adapter's layers (newest first), then the
 * adapter's own resolver, then the cached manifest index. A runtime-backed library
 * answers from live data rather than a cached snapshot, which is what keeps validation
 * exact for a library an editor can add to. A static library's answer is a map hit on an
 * already-loaded manifest and costs nothing.
 */
export const resolveIconMeta = async (
	adapter: IconAdapter,
	name: string,
	ctx: IconLayerContext
): Promise<IconMeta | null> => {
	if (adapter.layers && adapter.layers.length > 0) {
		const fromLayer = await resolveLayeredMeta(adapter, name, ctx)
		if (fromLayer) return fromLayer
	}
	if (adapter.resolveMetaMany) {
		const batch = await coalesceResolveMany({
			ctx,
			key: `adapter::${adapter.slug}`,
			name,
			resolveMetaMany: adapter.resolveMetaMany,
		})
		return batch.get(name) ?? null
	}
	if (adapter.resolveMeta) return adapter.resolveMeta(name, ctx)
	return (await loadManifestIndex(adapter)).get(name) ?? null
}
