import type { ComponentType } from 'react'
import type { IconRendererAdapter, IconRenderProps } from './types'

/**
 * Resolves one icon through an adapter's layers, newest first, so an override wins and an
 * older layer still answers names the newer one lacks. An adapter with no layers falls
 * back to `loadIcon`, which is every renderer written before layers existed.
 */
export const resolveRenderedIcon = async (
	adapter: IconRendererAdapter,
	name: string
): Promise<ComponentType<IconRenderProps> | null> => {
	const layers = adapter.layers
	if (layers && layers.length > 0) {
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const resolved = await layers[index]?.loadIcon(name)
			if (resolved) return resolved
		}
		return null
	}
	return adapter.loadIcon(name)
}
