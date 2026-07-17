import type { IconRendererAdapter } from '../../react/types'

export const lucideRenderer = (): IconRendererAdapter => ({
	slug: 'lucide',
	loadIcon: async (name) => {
		const imports = (await import('lucide-react/dynamicIconImports')).default
		const load = imports[name as keyof typeof imports]
		if (!load) return null
		return (await load()).default
	},
})
