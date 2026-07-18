import { createRequire } from 'node:module'
import path from 'node:path'
import type { IconMeta, IconNodeMap } from '../../../../types'
import type { LoadedIconSource } from '../types'

const require = createRequire(import.meta.url)

type TablerIconEntry = {
	name: string
	category: string
	tags: unknown[]
	styles: Record<string, unknown>
}

const pascal = (name: string): string =>
	name
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')

/**
 * `@tabler/icons` maps every subpath to `./icons/*`, so root JSON files are not
 * reachable by bare specifier. Anchor on a file the map does expose and walk
 * back to the package root for `file`.
 */
const rootJsonPath = (file: string): string => {
	const anchor = require.resolve('@tabler/icons/outline/heart.svg')
	return path.join(path.dirname(anchor), '..', '..', file)
}

/** Outline set only in v1; filled variants would double the manifest for little picker value. */
export const loadTablerSource = (): LoadedIconSource => {
	const json = require(rootJsonPath('icons.json')) as Record<string, TablerIconEntry>
	const entries = Object.values(json).filter((entry) => 'outline' in entry.styles)
	const icons: IconMeta[] = entries.map((entry) => ({
		name: entry.name,
		tags: entry.tags.filter((tag): tag is string => typeof tag === 'string'),
		categories: entry.category ? [entry.category.toLowerCase()] : [],
	}))
	// The outline node-data is keyed by the same bare kebab names as icons.json,
	// so no prefix normalization is needed for this package version.
	const nodes = require(rootJsonPath('tabler-nodes-outline.json')) as IconNodeMap
	return {
		icons,
		importFor: (icon) => ({
			module: `@tabler/icons-react/dist/esm/icons/Icon${pascal(icon.name)}.mjs`,
		}),
		nodes,
	}
}
