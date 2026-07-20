declare module '@tabler/icons-react/dist/esm/icons/*.mjs' {
	import type { ComponentType, SVGProps } from 'react'

	const Icon: ComponentType<
		SVGProps<SVGSVGElement> & { size?: number | string; stroke?: number | string }
	>
	export default Icon
}
