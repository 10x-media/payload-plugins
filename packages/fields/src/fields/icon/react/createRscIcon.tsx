import type { ComponentType, ReactNode } from 'react'
import { resolveIconValue } from '../shared/value'
import { resolveRenderedIcon } from './resolveRendered'
import type { IconProps, IconRendererAdapter, IconRenderProps } from './types'

/** Async server component factory: the per-icon import is awaited server-side and the SVG streams with zero client JS. */
export const createRscIcon = (args: {
	adapters: IconRendererAdapter[]
	defaultLibrary?: string
}): ((props: IconProps) => Promise<ReactNode>) => {
	const bySlug = new Map(args.adapters.map((adapter) => [adapter.slug, adapter]))
	const defaultLibrary = args.defaultLibrary ?? args.adapters[0]?.slug ?? ''
	/**
	 * Per-value resolution cache. A static `loadIcon` already rides the module
	 * cache, so this only earns its keep for an adapter that fetches, where it
	 * turns one request per render into one per process.
	 *
	 * Unconditionally permanent, which is safe only while every renderer adapter
	 * is a single static source. Revisit alongside per-layer cache policy; a
	 * dynamic layer against a permanent cache would serve a stale glyph forever.
	 */
	const cache = new Map<string, Promise<ComponentType<IconRenderProps> | null>>()

	const resolve = (
		adapter: IconRendererAdapter,
		name: string
	): Promise<ComponentType<IconRenderProps> | null> => {
		const key = `${adapter.slug}:${name}`
		let entry = cache.get(key)
		if (!entry) {
			entry = resolveRenderedIcon(adapter, name)
			cache.set(key, entry)
			// A rejected load must not poison the icon for the process lifetime; evict
			// so the next render retries. Same contract as the manifest cache, and the
			// reason this cache is safe for a network-backed adapter at all.
			void entry.catch(() => cache.delete(key))
		}
		return entry
	}

	return async ({ className, fallback = null, icon, label, size = 20 }: IconProps) => {
		if (!icon) return fallback
		const { library, name } = resolveIconValue(icon, defaultLibrary)
		const adapter = bySlug.get(library)
		if (!adapter) return fallback
		const Component = await resolve(adapter, name)
		if (!Component) return fallback
		return (
			<Component
				aria-hidden={label ? undefined : true}
				aria-label={label}
				className={className}
				role={label ? 'img' : undefined}
				size={size}
			/>
		)
	}
}
