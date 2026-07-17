import { createRequire } from 'node:module'
import path from 'node:path'
import type { IconMeta } from '../../../../types'
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
 * `@tabler/icons` maps every subpath to `./icons/*`, so `icons.json` is not
 * reachable by bare specifier. Anchor on a file the map does expose and walk
 * back to the package root.
 */
const iconsJsonPath = (): string => {
	const anchor = require.resolve('@tabler/icons/outline/heart.svg')
	return path.join(path.dirname(anchor), '..', '..', 'icons.json')
}

/** Outline set only in v1; filled variants would double the manifest for little picker value. */
export const loadTablerSource = (): LoadedIconSource => {
	const json = require(iconsJsonPath()) as Record<string, TablerIconEntry>
	const entries = Object.values(json)
		.filter((entry) => 'outline' in entry.styles)
		.sort((a, b) => a.name.localeCompare(b.name))
	const icons: IconMeta[] = entries.map((entry) => ({
		name: entry.name,
		tags: entry.tags.filter((tag): tag is string => typeof tag === 'string'),
		categories: entry.category ? [entry.category.toLowerCase()] : [],
	}))
	return {
		icons,
		importFor: (icon) => ({
			module: `@tabler/icons-react/dist/esm/icons/Icon${pascal(icon.name)}.mjs`,
		}),
	}
}
