import type { SerializedLexicalNode } from '@payloadcms/richtext-lexical/lexical'

import { CALLOUT_BLOCK_SLUG } from '../../editor/constants'
import type { WikiSeedTransformer } from '../types'

const MARKER = /^\[!(CAUTION|IMPORTANT|NOTE|TIP|WARNING)\]\s*/

const VARIANT_BY_MARKER: Record<string, string> = {
	CAUTION: 'danger',
	IMPORTANT: 'warning',
	NOTE: 'info',
	TIP: 'tip',
	WARNING: 'warning',
}

type NodeWithChildren = SerializedLexicalNode & {
	children?: NodeWithChildren[]
	text?: string
}

const blockId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 24)

const paragraphOf = (children: NodeWithChildren[]): NodeWithChildren =>
	({
		children,
		direction: null,
		format: '',
		indent: 0,
		type: 'paragraph',
		version: 1,
	}) as NodeWithChildren

/**
 * Find the GitHub alert marker in a blockquote's first text node. Lexical's
 * markdown conversion appends inline nodes directly to the quote (lines
 * separated by linebreak nodes); hand-authored lexical may wrap them in
 * paragraphs. Both shapes are handled.
 */
const firstTextOf = (quote: NodeWithChildren): NodeWithChildren | undefined => {
	const first = quote.children?.[0]
	if (!first) {
		return undefined
	}
	return typeof first.text === 'string' ? first : first.children?.[0]
}

const markerOf = (quote: NodeWithChildren): null | string => {
	const text = firstTextOf(quote)?.text
	return typeof text === 'string' ? (MARKER.exec(text)?.[1] ?? null) : null
}

/** Strip the marker and return the callout body as paragraph-level nodes. */
const bodyOf = (quote: NodeWithChildren): NodeWithChildren[] => {
	const children = [...(quote.children ?? [])]
	const first = children[0]
	if (first && typeof first.text === 'string') {
		first.text = first.text.replace(MARKER, '')
		let inline = children
		if (first.text.trim() === '') {
			inline = children.slice(1)
			if (inline[0]?.type === 'linebreak') {
				inline = inline.slice(1)
			}
		}
		return [paragraphOf(inline)]
	}
	const firstText = first?.children?.[0]
	if (first && firstText && typeof firstText.text === 'string') {
		firstText.text = firstText.text.replace(MARKER, '')
		if ((first.children ?? []).length === 1 && firstText.text.trim() === '') {
			children.shift()
		}
	}
	return children
}

/**
 * Built-in seed transformer: rewrites GitHub alert blockquotes (`> [!NOTE]`,
 * `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) produced by the
 * markdown conversion into the plugin's callout blocks. Unrecognized markers
 * stay plain blockquotes; only top-level quotes are considered, matching where
 * GitHub allows alerts.
 */
export const githubAlertsTransformer: WikiSeedTransformer = (state) => {
	const root = state.root as unknown as NodeWithChildren
	root.children = (root.children ?? []).map((node) => {
		if (node.type !== 'quote') {
			return node
		}
		const marker = markerOf(node)
		if (!marker) {
			return node
		}
		const body = bodyOf(node)
		return {
			fields: {
				blockType: CALLOUT_BLOCK_SLUG,
				body: {
					root: {
						children: body,
						direction: null,
						format: '',
						indent: 0,
						type: 'root',
						version: 1,
					},
				},
				id: blockId(),
				variant: VARIANT_BY_MARKER[marker],
			},
			format: '',
			type: 'block',
			version: 2,
		} as unknown as NodeWithChildren
	})
	return state
}
