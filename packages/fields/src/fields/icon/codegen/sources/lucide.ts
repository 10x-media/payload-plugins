import { createRequire } from 'node:module'
import type { IconMeta } from '../../../../types'
import type { LoadedIconSource } from '../types'

const require = createRequire(import.meta.url)

const CATEGORIES_URL = 'https://lucide.dev/api/categories'

/**
 * Lucide publishes names and tags to npm (lucide-static/tags.json) but not
 * categories; those exist only in the repo and on lucide.dev. Fetch them
 * best-effort so offline generation still succeeds with empty categories.
 */
const fetchCategories = async (): Promise<Record<string, string[]>> => {
	try {
		const response = await fetch(CATEGORIES_URL)
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return (await response.json()) as Record<string, string[]>
	} catch (error) {
		console.warn(
			`[fields codegen] lucide categories unavailable (${String(error)}); emitting empty categories`
		)
		return {}
	}
}

export const loadLucideSource = async (): Promise<LoadedIconSource> => {
	const tags = require('lucide-static/tags.json') as Record<string, string[]>
	const categories = await fetchCategories()
	const icons: IconMeta[] = Object.keys(tags)
		.sort()
		.map((name) => ({ name, tags: tags[name] ?? [], categories: categories[name] ?? [] }))
	return { icons }
}
