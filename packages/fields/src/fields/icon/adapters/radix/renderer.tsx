import type { ComponentType, CSSProperties } from 'react'
import type { IconRendererAdapter } from '../../react/types'

// The generated import map narrows props to { className, size }; radix icons are
// SVG components that also accept `style`, which is how this renderer sizes them.
type SizableIcon = ComponentType<{
	className?: string
	size?: number | string
	style?: CSSProperties
}>

export const radixRenderer = (): IconRendererAdapter => ({
	slug: 'radix',
	loadIcon: async (name) => {
		const imports: Record<string, () => Promise<{ default: SizableIcon }>> = (
			await import('./generated/imports')
		).iconImports
		const load = imports[name]
		if (!load) return null
		const { default: Component } = await load()
		// Radix icons size via width/height, not a `size` prop; normalize here.
		const Sized: ComponentType<{ className?: string; size?: number | string }> = ({
			className,
			size = 15,
			...rest
		}) => <Component {...rest} className={className} style={{ height: size, width: size }} />
		return Sized
	},
})
