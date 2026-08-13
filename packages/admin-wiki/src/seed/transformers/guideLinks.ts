import type { SerializedLexicalNode } from '@payloadcms/richtext-lexical/lexical'

import { WIKI_GUIDE_LINK_NODE_TYPE } from '../../editor/constants'
import type { WikiSeedTransformer } from '../types'

/** Matches a placeholder anywhere in a run of text; also used anchored, for link URLs. */
const PLACEHOLDER = /\{\{wiki:guide:([\w-]+)\}\}/
const PLACEHOLDER_URL = /^\{\{wiki:guide:([\w-]+)\}\}$/

type SeedNode = SerializedLexicalNode & {
	children?: SeedNode[]
	fields?: Record<string, unknown> & { url?: unknown }
	text?: string
}

/** A block field holding a nested editor state, as `{ root: { children } }`. */
type NestedState = { root: SeedNode }

const isNestedState = (value: unknown): value is NestedState => {
	if (typeof value !== 'object' || value === null || !('root' in value)) {
		return false
	}
	const { root } = value as { root: unknown }
	return typeof root === 'object' && root !== null && Array.isArray((root as SeedNode).children)
}

const resolveId = (
	slug: string,
	guideIdsBySlug: Record<string, number | string>
): number | string => {
	const id = guideIdsBySlug[slug]
	if (id === undefined) {
		throw new Error(`@10x-media/admin-wiki seed: content links to unknown guide slug "${slug}"`)
	}
	return id
}

/**
 * The serialized element node, spelled out rather than left to defaults: the
 * editor imports this JSON back through `updateFromJSON`, which reads `format`,
 * `indent`, and `direction` off it and would otherwise be handed `undefined`.
 */
const guideLinkNode = (guide: number | string, children: SeedNode[]): SeedNode =>
	({
		children,
		direction: 'ltr',
		format: '',
		guide,
		indent: 0,
		type: WIKI_GUIDE_LINK_NODE_TYPE,
		version: 1,
	}) as unknown as SeedNode

/**
 * Split one text node around every bare placeholder it holds. The link's own
 * text is the guide's title, and it inherits the surrounding run's formatting,
 * so a placeholder inside a bold sentence comes out bold.
 */
const splitTextNode = (
	node: SeedNode,
	guideIdsBySlug: Record<string, number | string>,
	guideTitlesBySlug: Record<string, string>
): SeedNode[] => {
	const out: SeedNode[] = []
	let remaining = node.text ?? ''
	let match = PLACEHOLDER.exec(remaining)
	while (match) {
		const slug = match[1] ?? ''
		const id = resolveId(slug, guideIdsBySlug)
		const before = remaining.slice(0, match.index)
		if (before) {
			out.push({ ...node, text: before })
		}
		out.push(guideLinkNode(id, [{ ...node, text: guideTitlesBySlug[slug] ?? slug }]))
		remaining = remaining.slice(match.index + match[0].length)
		match = PLACEHOLDER.exec(remaining)
	}
	if (remaining) {
		out.push({ ...node, text: remaining })
	}
	return out
}

/** The slug a link node points at, or null when it is an ordinary URL. */
const guideSlugOfLink = (node: SeedNode): null | string => {
	if (node.type !== 'link') {
		return null
	}
	const url = node.fields?.url
	return typeof url === 'string' ? (PLACEHOLDER_URL.exec(url)?.[1] ?? null) : null
}

/**
 * A block's own richText fields are editor states of their own, and the nodes
 * this transformer runs after put content there: a GitHub alert becomes a
 * callout whose body holds everything the blockquote said. Walking only the
 * outer tree would leave those placeholders behind as raw text, or, for the
 * `[words](placeholder)` form, as a plain link pointing at `{{wiki:guide:...}}`.
 */
const walkBlockFields = (
	node: SeedNode,
	guideIdsBySlug: Record<string, number | string>,
	guideTitlesBySlug: Record<string, string>
): void => {
	if (node.type !== 'block' || !node.fields) {
		return
	}
	for (const value of Object.values(node.fields)) {
		if (isNestedState(value)) {
			walk(value.root, guideIdsBySlug, guideTitlesBySlug)
		}
	}
}

const walk = (
	node: SeedNode,
	guideIdsBySlug: Record<string, number | string>,
	guideTitlesBySlug: Record<string, string>
): void => {
	walkBlockFields(node, guideIdsBySlug, guideTitlesBySlug)
	if (!node.children) {
		return
	}
	node.children = node.children.flatMap((child) => {
		const linkSlug = guideSlugOfLink(child)
		if (linkSlug !== null) {
			// The author already wrote the words; only the node around them changes.
			walk(child, guideIdsBySlug, guideTitlesBySlug)
			return [guideLinkNode(resolveId(linkSlug, guideIdsBySlug), child.children ?? [])]
		}
		if (typeof child.text === 'string' && PLACEHOLDER.test(child.text)) {
			return splitTextNode(child, guideIdsBySlug, guideTitlesBySlug)
		}
		walk(child, guideIdsBySlug, guideTitlesBySlug)
		return [child]
	})
}

/**
 * Built-in seed transformer: turns `{{wiki:guide:<slug>}}` placeholders into
 * guide-link nodes, in either of the two forms markdown offers.
 *
 * As a link target, `[read this first]({{wiki:guide:publishing-a-post}})`, the
 * author's own words become the link text. On its own, `{{wiki:guide:slug}}`
 * links the guide's title instead, which is what the placeholder always stood
 * for and is why the bare form is still worth having.
 *
 * Slugs resolve against every guide in the seed run (forward references
 * included), so guides can link to each other regardless of definition order;
 * an unknown slug fails loudly.
 */
export const guideLinksTransformer: WikiSeedTransformer = (state, context) => {
	walk(state.root as unknown as SeedNode, context.guideIdsBySlug, context.guideTitlesBySlug)
	return state
}
