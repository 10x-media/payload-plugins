import type { ComponentType, ReactNode } from 'react'

export type IconRenderProps = {
	'aria-hidden'?: boolean
	'aria-label'?: string
	className?: string
	role?: string
	size?: number | string
}

/** One frontend source within a library. Later layers win, matching the admin-side order. */
export type IconRendererLayer = {
	loadIcon: (name: string) => Promise<ComponentType<IconRenderProps> | null>
}

export type IconRendererAdapter = {
	slug: string
	/** Resolves one icon component by name, or null when unknown. Must import per icon (or per library where the package is single-module). */
	loadIcon: (name: string) => Promise<ComponentType<IconRenderProps> | null>
	/**
	 * Ordered sources, later winning, for a library whose frontend glyphs come from more
	 * than one place: a static package plus overrides, say. Each is asked in turn until one
	 * resolves, so an older layer still serves names a newer one lacks. Omit it and
	 * `loadIcon` drives everything, which is every renderer written before layers existed.
	 *
	 * Kept separate from the admin `IconAdapter` on purpose: merging them would drag
	 * manifest and drawer code into a frontend bundle.
	 */
	layers?: IconRendererLayer[]
}

export type IconProps = {
	className?: string
	fallback?: ReactNode
	icon?: null | string
	/** Accessible label; omitted renders aria-hidden decorative output. */
	label?: string
	size?: number | string
}
