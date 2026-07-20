import type { ReactNode } from 'react'
import { resolveIconValue } from '../shared/value'
import type { IconProps, IconRendererAdapter } from './types'

/** Async server component factory: the per-icon import is awaited server-side and the SVG streams with zero client JS. */
export const createRscIcon = (args: {
	adapters: IconRendererAdapter[]
	defaultLibrary?: string
}): ((props: IconProps) => Promise<ReactNode>) => {
	const bySlug = new Map(args.adapters.map((adapter) => [adapter.slug, adapter]))
	const defaultLibrary = args.defaultLibrary ?? args.adapters[0]?.slug ?? ''

	return async ({ className, fallback = null, icon, label, size = 20 }: IconProps) => {
		if (!icon) return fallback
		const { library, name } = resolveIconValue(icon, defaultLibrary)
		const adapter = bySlug.get(library)
		if (!adapter) return fallback
		const Component = await adapter.loadIcon(name)
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
