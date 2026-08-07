import type { SerializedLexicalNode } from '@payloadcms/richtext-lexical/lexical'

import { GUIDE_LINK_BLOCK_SLUG } from '../../editor/constants'
import type { WikiSeedTransformer } from '../types'

const PLACEHOLDER = /\{\{wiki:guide:([\w-]+)\}\}/

type NodeWithChildren = SerializedLexicalNode & {
	children?: NodeWithChildren[]
	text?: string
}

const blockId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 24)

const splitTextNode = (
	node: NodeWithChildren,
	guideIdsBySlug: Record<string, number | string>
): NodeWithChildren[] => {
	const out: NodeWithChildren[] = []
	let remaining = node.text ?? ''
	let match = PLACEHOLDER.exec(remaining)
	while (match) {
		const slug = match[1] ?? ''
		const id = guideIdsBySlug[slug]
		if (id === undefined) {
			throw new Error(`@10x-media/admin-wiki seed: content links to unknown guide slug "${slug}"`)
		}
		const before = remaining.slice(0, match.index)
		if (before) {
			out.push({ ...node, text: before })
		}
		out.push({
			fields: { blockType: GUIDE_LINK_BLOCK_SLUG, guide: id, id: blockId() },
			type: 'inlineBlock',
			version: 1,
		} as unknown as NodeWithChildren)
		remaining = remaining.slice(match.index + match[0].length)
		match = PLACEHOLDER.exec(remaining)
	}
	if (remaining) {
		out.push({ ...node, text: remaining })
	}
	return out
}

const walk = (node: NodeWithChildren, guideIdsBySlug: Record<string, number | string>): void => {
	if (!node.children) {
		return
	}
	node.children = node.children.flatMap((child) => {
		if (typeof child.text === 'string' && PLACEHOLDER.test(child.text)) {
			return splitTextNode(child, guideIdsBySlug)
		}
		walk(child, guideIdsBySlug)
		return [child]
	})
}

/**
 * Built-in seed transformer: replaces inline `{{wiki:guide:<slug>}}`
 * placeholders with guide-link inline blocks. Slugs resolve against every
 * guide in the seed run (forward references included), so guides can link to
 * each other regardless of definition order; an unknown slug fails loudly.
 */
export const guideLinksTransformer: WikiSeedTransformer = (state, context) => {
	walk(state.root as unknown as NodeWithChildren, context.guideIdsBySlug)
	return state
}
