import type { ComponentType, ReactNode } from 'react'

export type IconRenderProps = {
	'aria-hidden'?: boolean
	'aria-label'?: string
	className?: string
	role?: string
	size?: number | string
}

export type IconRendererAdapter = {
	slug: string
	/** Resolves one icon component by name, or null when unknown. Must import per icon (or per library where the package is single-module). */
	loadIcon: (name: string) => Promise<ComponentType<IconRenderProps> | null>
}

export type IconProps = {
	className?: string
	fallback?: ReactNode
	icon?: null | string
	/** Accessible label; omitted renders aria-hidden decorative output. */
	label?: string
	size?: number | string
}
