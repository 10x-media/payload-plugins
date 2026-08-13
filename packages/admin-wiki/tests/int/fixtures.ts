import type { Block, CollectionConfig, Config, GlobalConfig } from 'payload'

/**
 * Shared config fixtures for the server-side specs.
 *
 * Small on purpose: the walker's own coverage lives in `src/plugin/walker.test.ts`
 * against synthetic configs, so what these need is one of each entity kind, with
 * enough shape that a target key resolves (or deliberately does not).
 */

export const heroBlock: Block = {
	slug: 'hero',
	labels: { plural: 'Heroes', singular: 'Hero' },
	fields: [{ name: 'heading', type: 'text' }],
}

export const posts: CollectionConfig = {
	slug: 'posts',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'layout', type: 'blocks', blockReferences: ['hero'], blocks: [] },
	],
}

export const settings: GlobalConfig = {
	slug: 'settings',
	fields: [{ name: 'siteName', type: 'text' }],
}

/** Auth collection, so specs that exercise access have a real user to send. */
export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	fields: [],
}

export const fixtureCollections: CollectionConfig[] = [posts, users]

/** Localized in `en` and `de`, which is what makes the locale paths reachable. */
export const fixtureConfig: Partial<Config> = {
	blocks: [heroBlock],
	globals: [settings],
	localization: { defaultLocale: 'en', locales: ['en', 'de'] },
}

/** Every text node in a lexical state, joined, for asserting converted content. */
export const lexicalText = (content: unknown): string => {
	const out: string[] = []
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') {
			return
		}
		const candidate = node as { children?: unknown[]; text?: unknown }
		if (typeof candidate.text === 'string') {
			out.push(candidate.text)
		}
		for (const child of candidate.children ?? []) {
			walk(child)
		}
	}
	walk((content as { root?: unknown })?.root)
	return out.join(' ')
}

/** The first node in a lexical state matching a predicate, at any depth. */
export const lexicalNode = (
	content: unknown,
	matches: (node: Record<string, unknown>) => boolean
): Record<string, unknown> | undefined => {
	const stack: unknown[] = [(content as { root?: unknown })?.root]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node || typeof node !== 'object') {
			continue
		}
		const candidate = node as Record<string, unknown>
		if (matches(candidate)) {
			return candidate
		}
		// Reversed, because the stack pops last-in first: pushing in document order
		// would visit the last child first and return the last match, not the first.
		const children = (candidate.children as unknown[]) ?? []
		for (let index = children.length - 1; index >= 0; index -= 1) {
			stack.push(children[index])
		}
	}
	return undefined
}
