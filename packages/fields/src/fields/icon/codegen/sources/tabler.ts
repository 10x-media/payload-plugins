import { createRequire } from 'node:module'
import path from 'node:path'
import type { IconMeta, IconNode, IconNodeMap } from '../../../../types'
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

/**
 * Tabler's node-data is mostly React-ready, but a few glyphs carry raw SVG attribute names
 * (`stroke-width` on a `<g>`), which React rejects as DOM properties. Camel-case them, leaving
 * `data-` and `aria-` as written.
 */
const reactAttributeName = (name: string): string =>
	name.startsWith('data-') || name.startsWith('aria-')
		? name
		: name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const reactNode = ([tag, attrs, children]: IconNode): IconNode => {
	const renamed: Record<string, string> = {}
	for (const [key, value] of Object.entries(attrs)) renamed[reactAttributeName(key)] = value
	return children ? [tag, renamed, children.map(reactNode)] : [tag, renamed]
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
	const raw = require(rootJsonPath('tabler-nodes-outline.json')) as IconNodeMap
	const nodes: IconNodeMap = {}
	for (const [name, iconNodes] of Object.entries(raw)) nodes[name] = iconNodes.map(reactNode)
	return {
		icons,
		importFor: (icon) => ({
			module: `@tabler/icons-react/dist/esm/icons/Icon${pascal(icon.name)}.mjs`,
		}),
		nodes,
	}
}
