import { createRequire } from 'node:module'
import type { IconMeta, IconNodeMap } from '../../../../types'
import type { LoadedIconSource } from '../types'

const require = createRequire(import.meta.url)

const CATEGORIES_URL = 'https://lucide.dev/api/categories'
const FETCH_TIMEOUT_MS = 10_000

export type LucideSourceOptions = {
	/** Emit icons with no categories when lucide.dev is unreachable (offline generation). */
	allowMissingCategories?: boolean
}

/**
 * Lucide publishes names and tags to npm (lucide-static/tags.json) but not
 * categories; those exist only in the repo and on lucide.dev. Throws rather
 * than returning a partial result, so the caller decides what a miss means.
 */
const fetchCategories = async (): Promise<Record<string, unknown>> => {
	const response = await fetch(CATEGORIES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	const payload: unknown = await response.json()
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		throw new Error('expected a JSON object keyed by icon name')
	}
	return payload as Record<string, unknown>
}

/**
 * Lucide ships icons named `map` and `slice`, so an unexpected array payload
 * would resolve those keys to Array.prototype methods. Only real arrays of
 * strings count as categories.
 */
const categoriesFor = (payload: Record<string, unknown>, name: string): string[] => {
	const value = payload[name]
	if (!Array.isArray(value)) return []
	return value.filter((entry): entry is string => typeof entry === 'string')
}

export const loadLucideSource = async (
	options: LucideSourceOptions = {}
): Promise<LoadedIconSource> => {
	const tags = require('lucide-static/tags.json') as Record<string, string[]>
	const allowMissing = options.allowMissingCategories === true
	let payload: Record<string, unknown> = {}
	try {
		payload = await fetchCategories()
	} catch (error) {
		if (!allowMissing) {
			throw new Error(
				`lucide categories unavailable from ${CATEGORIES_URL} (${String(error)}). Pass allowMissingCategories to generate without them.`
			)
		}
		console.warn(
			`[fields codegen] lucide categories unavailable (${String(error)}); emitting empty categories`
		)
	}
	const icons: IconMeta[] = Object.keys(tags)
		.sort()
		.map((name) => ({ name, tags: tags[name] ?? [], categories: categoriesFor(payload, name) }))
	// A fetch that succeeds but matches nothing means the response shape moved.
	// Without this the manifest would be rewritten with every category dropped.
	if (!allowMissing && icons.every((icon) => icon.categories.length === 0)) {
		throw new Error(
			`lucide categories from ${CATEGORIES_URL} matched no installed icon, so the response shape has likely changed. Pass allowMissingCategories to generate without them.`
		)
	}
	// lucide-static/icon-nodes.json is the exact shape lucide-react consumes
	// (name -> [tag, attrs][]) and is keyed by the same bare kebab names as tags.json.
	const nodes = require('lucide-static/icon-nodes.json') as IconNodeMap
	return { icons, nodes }
}
