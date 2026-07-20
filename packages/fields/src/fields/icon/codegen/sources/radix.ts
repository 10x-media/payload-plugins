import { createRequire } from 'node:module'
import type { IconMeta } from '../../../../types'
import type { LoadedIconSource } from '../types'

const require = createRequire(import.meta.url)

const kebab = (pascal: string): string =>
	pascal
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
		.toLowerCase()

/** Radix ships no metadata; names come from the module's export list, tags from name tokens. */
export const loadRadixSource = (): LoadedIconSource => {
	const mod = require('@radix-ui/react-icons') as Record<string, unknown>
	const exportNames = Object.keys(mod)
		.filter((name) => name.endsWith('Icon'))
		.sort()
	const exportByName = new Map<string, string>()
	const icons: IconMeta[] = exportNames.map((exportName) => {
		const name = kebab(exportName.slice(0, -'Icon'.length))
		exportByName.set(name, exportName)
		return { name, tags: name.split('-'), categories: [] }
	})
	return {
		icons,
		importFor: (icon) => {
			const exportName = exportByName.get(icon.name)
			if (!exportName) throw new Error(`radix: no export for icon "${icon.name}"`)
			return { module: '@radix-ui/react-icons', exportName }
		},
	}
}
