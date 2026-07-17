import type { IconRendererAdapter } from '../../react/types'

export const tablerRenderer = (): IconRendererAdapter => ({
	slug: 'tabler',
	loadIcon: async (name) => {
		const imports = (await import('./generated/imports')).iconImports
		const load = imports[name]
		if (!load) return null
		return (await load()).default
	},
})
